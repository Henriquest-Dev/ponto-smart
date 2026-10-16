"use client";

import { Camera, ImageSquare, Star, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { shrinkImage } from "@/lib/image";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { cn } from "@/lib/utils";

export const PHOTO_BUCKET = "oficina";
export type Photo = { id: string; key: string; thumb: string | null; at: string };

// Endereços assinados válidos por 1 hora, guardados para não pedir de novo a cada ecrã.
const cache = new Map<string, { url: string; until: number }>();
export async function photoUrl(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb().storage.from(PHOTO_BUCKET).createSignedUrl(key, 3600);
  if (error || !data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

export function usePhotoUrl(key: string | null | undefined) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setUrl(null);
    if (key) void photoUrl(key).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

/** Foto de perfil da viatura (ou um carro desenhado quando ainda não há foto). */
export function VehicleAvatar({ photoKey, plate, className }: { photoKey: string | null | undefined; plate: string; className?: string }) {
  const url = usePhotoUrl(photoKey);
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-subtle", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Viatura ${plate}`} className="size-full object-cover" />
      ) : (
        <svg viewBox="0 0 48 32" className="w-3/5" aria-hidden>
          <path
            d="M6 22v-5l5-8c1-1.6 2.5-2.5 4.4-2.5h17.2c1.9 0 3.4.9 4.4 2.5l5 8v5a2 2 0 0 1-2 2h-2a4.5 4.5 0 0 1-9 0H19a4.5 4.5 0 0 1-9 0H8a2 2 0 0 1-2-2Zm8-7h20l-3.2-5.2c-.3-.5-.8-.8-1.4-.8H18.6c-.6 0-1.1.3-1.4.8Z"
            fill="currentColor"
          />
        </svg>
      )}
    </span>
  );
}

/** Envia a foto (versão grande e miniatura) e regista-a na viatura. */
export async function uploadVehiclePhoto(companyId: string, vehicleId: string, file: File) {
  const [big, small] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 360, 0.75)]);
  const id = crypto.randomUUID();
  const key = `${companyId}/${vehicleId}/${id}.jpg`;
  const thumb = `${companyId}/${vehicleId}/${id}_t.jpg`;
  const store = sb().storage.from(PHOTO_BUCKET);
  const a = await store.upload(key, big, { contentType: "image/jpeg", upsert: false });
  if (a.error) throw new Error(/bucket|not found/i.test(a.error.message) ? "Corra o script supabase/04_parte13.sql para activar as fotos." : a.error.message);
  const b = await store.upload(thumb, small, { contentType: "image/jpeg", upsert: false });
  await rpc("ps_vehicle_photo_add", { p_vehicle: vehicleId, p_key: key, p_thumb: b.error ? null : thumb });
}

/** Botões para tirar foto com a câmara ou escolher da galeria. */
export function PhotoPicker({ onFiles, busy, compact }: { onFiles: (files: File[]) => void; busy?: boolean; compact?: boolean }) {
  const camera = React.useRef<HTMLInputElement>(null);
  const gallery = React.useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.currentTarget.files ?? [])].filter((f) => f.type.startsWith("image/"));
    e.currentTarget.value = "";
    if (files.length) onFiles(files);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
      <Button type="button" size={compact ? "sm" : "md"} variant="soft" disabled={busy} onClick={() => camera.current?.click()}>
        {busy ? <span className="spinner" aria-hidden /> : <Camera className="size-4" aria-hidden />} Tirar foto
      </Button>
      <Button type="button" size={compact ? "sm" : "md"} variant="ghost" disabled={busy} onClick={() => gallery.current?.click()}>
        <ImageSquare className="size-4" aria-hidden /> Da galeria
      </Button>
    </div>
  );
}

/** Galeria da viatura: juntar fotos, escolher a de perfil e apagar. */
export function VehicleGallery({
  companyId,
  vehicleId,
  plate,
  photos,
  coverId,
  onChange,
}: {
  companyId: string;
  vehicleId: string;
  plate: string;
  photos: Photo[];
  coverId: string | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<Photo | null>(null);
  const add = async (files: File[]) => {
    setBusy(true);
    try {
      for (const f of files) await uploadVehiclePhoto(companyId, vehicleId, f);
      toast.success(files.length === 1 ? "Foto juntada." : `${files.length} fotos juntadas.`);
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: Photo) => {
    if (!window.confirm("Apagar esta foto?")) return;
    try {
      const keys = await rpc<string[]>("ps_vehicle_photo_delete", { p_photo: p.id });
      if (keys?.length) await sb().storage.from(PHOTO_BUCKET).remove(keys);
      setOpen(null);
      onChange();
      toast.success("Foto apagada.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const cover = async (p: Photo) => {
    try {
      await rpc("ps_vehicle_photo_cover", { p_photo: p.id });
      setOpen(null);
      onChange();
      toast.success("Foto de perfil mudada.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-3">
      {photos.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p)} className="relative block aspect-square w-full overflow-hidden rounded-lg bg-surface-2" aria-label="Ver foto">
                <Thumb photoKey={p.thumb ?? p.key} plate={plate} />
                {p.id === coverId ? (
                  <span className="absolute top-1 left-1 rounded-md bg-foreground/80 px-1.5 py-0.5 text-[10.5px] font-bold text-white">Perfil</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">Junte fotos da viatura: a primeira fica como foto de perfil e ajuda a reconhecer o carro.</p>
      )}
      <PhotoPicker onFiles={(f) => void add(f)} busy={busy} compact />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DialogContent title={`Foto da viatura ${plate}`} wide>
            <FullPhoto photoKey={open.key} plate={plate} />
            <div className="mt-4 flex flex-wrap gap-2">
              {open.id !== coverId ? (
                <Button onClick={() => void cover(open)}>
                  <Star className="size-4" aria-hidden /> Usar como foto de perfil
                </Button>
              ) : (
                <span className="inline-flex h-10 items-center text-[13px] font-bold text-muted">Esta é a foto de perfil.</span>
              )}
              <Button variant="danger-outline" onClick={() => void remove(open)}>
                <Trash className="size-4" aria-hidden /> Apagar
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function Thumb({ photoKey, plate }: { photoKey: string; plate: string }) {
  const url = usePhotoUrl(photoKey);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={`Viatura ${plate}`} className="size-full object-cover" /> : <span className="block size-full animate-pulse" />;
}

function FullPhoto({ photoKey, plate }: { photoKey: string; plate: string }) {
  const url = usePhotoUrl(photoKey);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={`Viatura ${plate}`} className="max-h-[60dvh] w-full rounded-lg object-contain" />
  ) : (
    <div className="aspect-video w-full animate-pulse rounded-lg bg-surface-2" />
  );
}
