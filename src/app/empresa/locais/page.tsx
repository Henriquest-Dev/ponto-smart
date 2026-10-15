"use client";

import { LocateFixed, MapPin, MonitorSmartphone, Pencil, Plus, Printer, QrCode } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock, NoAccess } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/lib/format";
import { attempt, formObject } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, withBase } from "@/lib/sb/use-data";

const GeofenceMap = dynamic(() => import("@/components/maps/geofence-map").then((m) => m.GeofenceMap), {
  ssr: false,
  loading: () => <Skeleton className="h-44 w-full rounded-none" />,
});

const STATION_COLUMNS = "id,company_id,location_id,name,qr_mode,rotation_seconds,active,last_seen_at,created_at";

type Location = {
  id: string;
  name: string;
  branch_id: string | null;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  max_accuracy_m: number;
  active: boolean;
  branches: { name: string } | null;
};
type Station = {
  id: string;
  location_id: string;
  name: string;
  qr_mode: "dynamic" | "static";
  rotation_seconds: number;
  active: boolean;
  last_seen_at: string | null;
};

export default function LocationsPage() {
  const { can } = useCompany();
  if (!can("locations.manage", "stations.display")) return <NoAccess title="Locais e estações" />;
  return <Locations />;
}

function Locations() {
  const { companyId, can, tz } = useCompany();
  const manage = can("locations.manage");
  const display = can("stations.display");

  const data = useData(async () => {
    const [l, s, b] = await Promise.all([
      sb()
        .from("work_locations")
        .select("id,name,branch_id,center_lat,center_lng,radius_m,max_accuracy_m,active,branches(name)")
        .eq("company_id", companyId)
        .order("name"),
      sb().from("attendance_stations").select(STATION_COLUMNS).eq("company_id", companyId).order("name"),
      sb().from("branches").select("id,name").eq("company_id", companyId).order("name"),
    ]);
    return {
      locations: (must(l) as unknown as Location[]).map((x) => ({ ...x, center_lat: Number(x.center_lat), center_lng: Number(x.center_lng) })),
      stations: must(s) as Station[],
      branches: must(b) as { id: string; name: string }[],
    };
  }, [companyId]);

  return (
    <>
      <PageHeader
        title="Locais e estações"
        description="Perímetros de marcação (geofence) e ecrãs de QR Code."
        actions={manage && data.data ? <LocationEditor branches={data.data.branches} onDone={data.reload} /> : null}
      />
      <PageBody>
        <Notice tone="info">
          Recomenda-se QR dinâmico num ecrã (tablet ou computador) na recepção: muda a cada poucos segundos e não pode ser fotografado para uso posterior.
          O QR fixo impresso é copiável e oferece menor garantia.
        </Notice>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data && !data.error ? <LoadingBlock rows={2} /> : null}
        {data.data && data.data.locations.length === 0 ? (
          <EmptyState icon={<MapPin />} title="Sem locais configurados" description="Crie um local com o perímetro onde os colaboradores podem marcar ponto." />
        ) : null}
        {data.data && data.data.locations.length > 0 ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {data.data.locations.map((l) => {
              const st = data.data!.stations.filter((s) => s.location_id === l.id);
              return (
                <Card key={l.id} className="overflow-hidden">
                  <GeofenceMap lat={l.center_lat} lng={l.center_lng} radius={l.radius_m} className="z-0 h-44 w-full" />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                          {l.name}
                          {!l.active ? <Badge tone="neutral">Inactivo</Badge> : null}
                        </p>
                        <p className="text-xs text-muted">
                          {l.branches?.name ?? "Sem filial"} · raio {l.radius_m} m · precisão GPS aceite até ±{l.max_accuracy_m} m
                        </p>
                      </div>
                      {manage ? <LocationEditor branches={data.data!.branches} location={l} onDone={data.reload} /> : null}
                    </div>
                    <div className="mt-4 space-y-2">
                      {st.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                          <MonitorSmartphone className="size-4 text-muted" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{s.name}</p>
                            <p className="text-xs text-muted">
                              {s.qr_mode === "dynamic" ? `QR dinâmico · roda a cada ${s.rotation_seconds}s` : "QR fixo (menor garantia)"}
                              {s.last_seen_at ? ` · activo ${formatDateTime(s.last_seen_at, tz)}` : ""}
                            </p>
                          </div>
                          {!s.active ? <Badge tone="neutral">Inactiva</Badge> : null}
                          {s.active && s.qr_mode === "dynamic" && display ? (
                            <Button size="sm" variant="soft" asChild>
                              <Link href={`/estacao/?id=${s.id}`} target="_blank">Abrir ecrã</Link>
                            </Button>
                          ) : null}
                          {s.active && s.qr_mode === "static" && manage ? <StaticQr station={s} onDone={data.reload} /> : null}
                          {manage ? <StationEditor locationId={l.id} station={s} onDone={data.reload} /> : null}
                          {manage ? (
                            <ActionButton
                              size="sm"
                              variant="ghost"
                              action={() =>
                                attempt(async () => {
                                  must(await sb().from("attendance_stations").update({ active: !s.active }).eq("id", s.id).select("id"));
                                  data.reload();
                                  return s.active ? "Estação desactivada." : "Estação activada.";
                                })
                              }
                            >
                              {s.active ? "Desactivar" : "Activar"}
                            </ActionButton>
                          ) : null}
                        </div>
                      ))}
                      {st.length === 0 && !manage ? <p className="text-[13px] text-muted">Sem estações neste local.</p> : null}
                      {manage ? <StationEditor locationId={l.id} onDone={data.reload} /> : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}

function LocationEditor({ location, branches, onDone }: { location?: Location; branches: { id: string; name: string }[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  const [lat, setLat] = React.useState(location?.center_lat ?? -25.9692);
  const [lng, setLng] = React.useState(location?.center_lng ?? 32.5732);
  const [radius, setRadius] = React.useState(location?.radius_m ?? 60);

  const useMine = () => {
    if (!navigator.geolocation) return void toast.error("Este dispositivo não fornece localização.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(Number(p.coords.latitude.toFixed(6)));
        setLng(Number(p.coords.longitude.toFixed(6)));
        toast.success(`Posição obtida (±${Math.round(p.coords.accuracy)} m).`);
      },
      () => toast.error("Não foi possível obter a localização."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      const centerLat = Number(String(o.centerLat ?? "").replace(",", "."));
      const centerLng = Number(String(o.centerLng ?? "").replace(",", "."));
      const radiusM = Math.round(Number(o.radiusM));
      const maxAccuracyM = Math.round(Number(o.maxAccuracyM));
      if (!o.name || o.name.length < 3) throw new Error("Indique o nome do local.");
      if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) throw new Error("Latitude inválida.");
      if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) throw new Error("Longitude inválida.");
      if (!(radiusM >= 5 && radiusM <= 5000)) throw new Error("Raio entre 5 e 5000 m.");
      if (!(maxAccuracyM >= 10 && maxAccuracyM <= 500)) throw new Error("Precisão máxima entre 10 e 500 m.");
      const values = {
        name: o.name,
        branch_id: o.branchId ?? null,
        center_lat: centerLat,
        center_lng: centerLng,
        radius_m: radiusM,
        max_accuracy_m: maxAccuracyM,
        active: o.active === "1",
      };
      if (location) must(await sb().from("work_locations").update(values).eq("id", location.id).select("id"));
      else must(await sb().from("work_locations").insert({ ...values, company_id: companyId }).select("id"));
      onDone();
      return "Local guardado.";
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setLat(location?.center_lat ?? -25.9692);
          setLng(location?.center_lng ?? 32.5732);
          setRadius(location?.radius_m ?? 60);
        }
      }}
    >
      <DialogTrigger asChild>
        {location ? (
          <Button size="icon-sm" variant="ghost" aria-label="Editar local"><Pencil /></Button>
        ) : (
          <Button><Plus /> Novo local</Button>
        )}
      </DialogTrigger>
      <DialogContent title={location ? "Editar local" : "Novo local"} description="Toque no mapa para definir o centro do perímetro." wide>
        <ActionForm action={save} onSuccess={() => setOpen(false)} resetOnSuccess={false} className="space-y-4">
          {open ? (
            <GeofenceMap
              lat={lat}
              lng={lng}
              radius={radius}
              editable
              onPick={(a, b) => {
                setLat(a);
                setLng(b);
              }}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome"><Input name="name" required defaultValue={location?.name} /></Field>
            <Field label="Filial">
              <Select name="branchId" defaultValue={location?.branch_id ?? ""}>
                <option value="">—</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Latitude">
              <Input name="centerLat" value={lat} onChange={(e) => setLat(Number(e.target.value))} inputMode="decimal" required />
            </Field>
            <Field label="Longitude">
              <Input name="centerLng" value={lng} onChange={(e) => setLng(Number(e.target.value))} inputMode="decimal" required />
            </Field>
            <Field label={`Raio do perímetro: ${radius} m`} hint="Num recinto pequeno, deixe margem para a imprecisão do GPS.">
              <input
                type="range"
                name="radiusM"
                min={20}
                max={500}
                step={5}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="accent-primary"
              />
            </Field>
            <Field label="Precisão GPS máxima (m)" hint="Acima disto a marcação fica em revisão.">
              <Input name="maxAccuracyM" type="number" min={10} max={500} defaultValue={location?.max_accuracy_m ?? 80} />
            </Field>
            <Field label="Estado">
              <Select name="active" defaultValue={location && !location.active ? "0" : "1"}>
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </Select>
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

function StationEditor({ locationId, station, onDone }: { locationId: string; station?: Station; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<string>(station?.qr_mode ?? "dynamic");

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      if (!o.name || o.name.length < 3) throw new Error("Indique o nome da estação.");
      const qrMode = o.qrMode === "static" ? "static" : "dynamic";
      const rotation = Math.round(Number(o.rotationSeconds ?? station?.rotation_seconds ?? 30));
      if (qrMode === "dynamic" && !(rotation >= 10 && rotation <= 300)) throw new Error("Rotação entre 10 e 300 segundos.");
      const values = { name: o.name, qr_mode: qrMode, rotation_seconds: qrMode === "dynamic" ? rotation : (station?.rotation_seconds ?? 30) };
      if (station) must(await sb().from("attendance_stations").update(values).eq("id", station.id).select("id"));
      else must(await sb().from("attendance_stations").insert({ ...values, company_id: companyId, location_id: locationId }).select("id"));
      onDone();
      if (qrMode === "static" && (!station || station.qr_mode !== "static")) return "Estação guardada. Gere o QR fixo para imprimir.";
      return station ? "Estação actualizada." : "Estação criada.";
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setMode(station?.qr_mode ?? "dynamic");
      }}
    >
      <DialogTrigger asChild>
        {station ? (
          <Button size="icon-sm" variant="ghost" aria-label="Editar estação"><Pencil /></Button>
        ) : (
          <Button size="sm" variant="ghost" className="w-full border border-dashed border-border-strong"><Plus /> Adicionar estação</Button>
        )}
      </DialogTrigger>
      <DialogContent title={station ? "Editar estação" : "Nova estação de marcação"}>
        <ActionForm action={save} onSuccess={() => setOpen(false)} resetOnSuccess={!station} className="space-y-4">
          <Field label="Nome"><Input name="name" required placeholder="Ex.: Recepção" defaultValue={station?.name} /></Field>
          <Field label="Tipo de QR">
            <Select name="qrMode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="dynamic">Dinâmico em ecrã (recomendado)</option>
              <option value="static">Fixo impresso (menor garantia)</option>
            </Select>
          </Field>
          {mode === "dynamic" ? (
            <Field label="Rotação (segundos)">
              <Input name="rotationSeconds" type="number" min={10} max={300} defaultValue={station?.rotation_seconds ?? 30} />
            </Field>
          ) : (
            <Notice tone="warning">
              Um QR impresso pode ser fotografado e usado fora do local. Use apenas com política de risco aprovada e geofence activo.
            </Notice>
          )}
          <SubmitButton className="w-full">{station ? "Guardar estação" : "Criar estação"}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function StaticQr({ station, onDone }: { station: Station; onDone: () => void }) {
  const [qr, setQr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="soft"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Gerar um novo QR fixo revoga o anterior. Continuar?")) return;
          start(async () => {
            try {
              const token = await rpc<string>("ps_station_static_qr", { p_station: station.id });
              const QRCode = (await import("qrcode")).default;
              const url = `${window.location.origin}${withBase(`/app/marcar/?t=${encodeURIComponent(token)}`)}`;
              setQr(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
              toast.success("Novo QR fixo gerado. O anterior foi revogado.");
              onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Não foi possível gerar o QR.");
            }
          });
        }}
      >
        <QrCode /> QR fixo
      </Button>
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent title={`QR fixo · ${station.name}`} description="Imprima e afixe no local. Este código não volta a ser mostrado.">
          <div id="ps-print-qr" className="mx-auto w-64 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr ?? "" }} />
          <Button className="mt-4 w-full" variant="outline" onClick={() => printSvg(qr ?? "", station.name)}>
            <Printer /> Imprimir
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Imprime apenas o QR numa janela própria (evita imprimir o painel inteiro). */
function printSvg(svg: string, name: string) {
  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) return void toast.error("Permita janelas pop-up para imprimir.");
  const safeName = name.replace(/[<>&"]/g, "");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>QR · ${safeName}</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px}svg{width:320px;height:320px}</style></head><body><h2>${safeName}</h2>${svg}<p>Marque o ponto com a app PontoSmart.</p></body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
