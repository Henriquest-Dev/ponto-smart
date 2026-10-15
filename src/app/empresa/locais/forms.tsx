"use client";

import dynamic from "next/dynamic";
import { LocateFixed, Pencil, Plus, Printer, QrCode } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice, Skeleton } from "@/components/ui/misc";
import { generateStaticQrAction, saveLocationAction, saveStationAction } from "./actions";

const GeofenceMap = dynamic(() => import("@/components/maps/geofence-map").then((m) => m.GeofenceMap), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

export function LocationPreview({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  return <GeofenceMap lat={lat} lng={lng} radius={radius} className="z-0 h-44 w-full" />;
}

type Loc = { id: string; name: string; branchId: string | null; centerLat: number; centerLng: number; radiusM: number; maxAccuracyM: number };

export function LocationEditor({ location, branches }: { location?: Loc; branches: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(location?.centerLat ?? -25.9692);
  const [lng, setLng] = useState(location?.centerLng ?? 32.5732);
  const [radius, setRadius] = useState(location?.radiusM ?? 60);
  const useMine = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(Number(p.coords.latitude.toFixed(6)));
        setLng(Number(p.coords.longitude.toFixed(6)));
        toast.success(`Posição obtida (±${Math.round(p.coords.accuracy)} m).`);
      },
      () => toast.error("Não foi possível obter a localização."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {location ? <Button size="icon-sm" variant="ghost" aria-label="Editar local"><Pencil /></Button> : <Button><Plus /> Novo local</Button>}
      </DialogTrigger>
      <DialogContent title={location ? "Editar local" : "Novo local"} description="Toque no mapa para definir o centro do perímetro." wide>
        <ActionForm action={saveLocationAction} onSuccess={() => setOpen(false)} resetOnSuccess={false} className="space-y-4">
          {location ? <input type="hidden" name="id" value={location.id} /> : null}
          {open ? <GeofenceMap lat={lat} lng={lng} radius={radius} editable onPick={(a, b) => { setLat(a); setLng(b); }} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome"><Input name="name" required defaultValue={location?.name} /></Field>
            <Field label="Filial">
              <Select name="branchId" defaultValue={location?.branchId ?? ""}>
                <option value="">—</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Latitude"><Input name="centerLat" value={lat} onChange={(e) => setLat(Number(e.target.value))} inputMode="decimal" required /></Field>
            <Field label="Longitude"><Input name="centerLng" value={lng} onChange={(e) => setLng(Number(e.target.value))} inputMode="decimal" required /></Field>
            <Field label={`Raio do perímetro: ${radius} m`} hint="Num recinto pequeno, deixe margem para a imprecisão do GPS.">
              <input type="range" name="radiusM" min={20} max={500} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="accent-primary" />
            </Field>
            <Field label="Precisão GPS máxima (m)" hint="Acima disto a marcação fica em revisão.">
              <Input name="maxAccuracyM" type="number" min={10} max={500} defaultValue={location?.maxAccuracyM ?? 80} />
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={useMine}><LocateFixed /> Usar a minha localização</Button>
            <SubmitButton>Guardar local</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function NewStation({ locationId }: { locationId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("dynamic");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="w-full border border-dashed border-border-strong"><Plus /> Adicionar estação</Button>
      </DialogTrigger>
      <DialogContent title="Nova estação de marcação">
        <ActionForm action={saveStationAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="locationId" value={locationId} />
          <Field label="Nome"><Input name="name" required placeholder="Ex.: Recepção" /></Field>
          <Field label="Tipo de QR">
            <Select name="qrMode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="dynamic">Dinâmico em ecrã (recomendado)</option>
              <option value="static">Fixo impresso (menor garantia)</option>
            </Select>
          </Field>
          {mode === "dynamic" ? (
            <Field label="Rotação (segundos)"><Input name="rotationSeconds" type="number" min={10} max={300} defaultValue={30} /></Field>
          ) : (
            <Notice tone="warning">Um QR impresso pode ser fotografado e usado fora do local. Use apenas com política de risco aprovada e geofence activo.</Notice>
          )}
          <SubmitButton className="w-full">Criar estação</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function StaticQr({ stationId }: { stationId: string }) {
  const [qr, setQr] = useState<{ svg: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="soft"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Gerar um novo QR fixo revoga o anterior. Continuar?")) return;
          start(async () => {
            const r = await generateStaticQrAction(stationId);
            if (r.ok && r.data) setQr(r.data as { svg: string; name: string });
            else if (!r.ok) toast.error(r.error);
          });
        }}
      >
        <QrCode /> QR fixo
      </Button>
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent title={`QR fixo · ${qr?.name ?? ""}`} description="Imprima e afixe no local. Este código não volta a ser mostrado.">
          <div id="ps-print-qr" className="mx-auto w-64" dangerouslySetInnerHTML={{ __html: qr?.svg ?? "" }} />
          <Button className="mt-4 w-full" variant="outline" onClick={() => window.print()}><Printer /> Imprimir</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
