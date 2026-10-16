"use client";

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
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

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
  tolerance_m?: number;
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
    const cols = "id,name,branch_id,center_lat,center_lng,radius_m,max_accuracy_m,active,branches(name)";
    const locations = async () => {
      // A margem de tolerância chega com o script 04_parte8.sql; sem ele, o resto continua a funcionar.
      const r = await sb().from("work_locations").select(`${cols},tolerance_m`).eq("company_id", companyId).order("name");
      return r.error ? sb().from("work_locations").select(cols).eq("company_id", companyId).order("name") : r;
    };
    const [l, s, b] = await Promise.all([
      locations(),
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
          Cada estação tem QR dinâmico (num ecrã na entrada, muda a cada poucos segundos) e QR fixo (impresso). Os dois funcionam ao mesmo tempo.
          O QR fixo e o horário do QR estão em QR Code.
        </Notice>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data && !data.error ? <LoadingBlock rows={2} /> : null}
        {data.data && data.data.locations.length === 0 ? (
          <EmptyState title="Sem locais configurados" description="Crie um local com o perímetro onde os colaboradores podem marcar ponto." />
        ) : null}
        {data.data && data.data.locations.length > 0 ? (
          <div className="space-y-5">
            {data.data.locations.map((l) => {
              const st = data.data!.stations.filter((s) => s.location_id === l.id);
              return (
                <Card key={l.id} className="grid overflow-hidden lg:grid-cols-[minmax(0,340px)_1fr]">
                  <GeofenceMap lat={l.center_lat} lng={l.center_lng} radius={l.radius_m} className="z-0 h-44 w-full lg:h-full lg:min-h-56" />
                  <div className="p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-3 text-[18px] font-bold tracking-[-0.01em]">
                          {l.name}
                          {!l.active ? <Badge tone="neutral">Inactivo</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted">{l.branches?.name ?? "Sem filial"}</p>
                        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                          <div>
                            <dt className="text-[12px] text-muted">Raio</dt>
                            <dd className="text-[20px] leading-tight font-bold tabular">{l.radius_m} m</dd>
                          </div>
                          <div>
                            <dt className="text-[12px] text-muted">Precisão GPS aceite</dt>
                            <dd className="text-[20px] leading-tight font-bold tabular">±{l.max_accuracy_m} m</dd>
                          </div>
                          {l.tolerance_m ? (
                            <div>
                              <dt className="text-[12px] text-muted">Margem</dt>
                              <dd className="text-[20px] leading-tight font-bold tabular">+{l.tolerance_m} m</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                      {manage ? <LocationEditor branches={data.data!.branches} location={l} onDone={data.reload} /> : null}
                    </div>
                    <div className="mt-5 space-y-2">
                      {st.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3">
                          <span className={`stem ${s.active ? "text-primary" : "text-border-strong"}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-bold">{s.name}</p>
                            <p className="text-xs text-muted">
                              QR dinâmico (muda a cada {s.rotation_seconds} s) e QR fixo
                            </p>
                            {s.last_seen_at ? <p className="text-xs text-muted">Visto em {formatDateTime(s.last_seen_at, tz)}</p> : null}
                          </div>
                          {!s.active ? <Badge tone="neutral">Inactiva</Badge> : null}
                          {s.active && display ? (
                            <Button size="sm" variant="soft" asChild>
                              <Link href={`/estacao/?id=${s.id}`} target="_blank">Abrir ecrã</Link>
                            </Button>
                          ) : null}
                          {s.active && manage ? (
                            <Button size="sm" variant="soft" asChild>
                              <Link href="/empresa/qr/">QR fixo e link</Link>
                            </Button>
                          ) : null}
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
  const [tolerance, setTolerance] = React.useState(location?.tolerance_m ?? 0);
  const [me, setMe] = React.useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = React.useState(false);

  /** Lê o GPS durante alguns segundos e fica com a leitura mais precisa. */
  const useMine = () => {
    if (!navigator.geolocation) return void toast.error("Este dispositivo não fornece localização.");
    setLocating(true);
    let best: GeolocationPosition | null = null;
    const finish = () => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      setLocating(false);
      if (!best) return void toast.error("Não foi possível obter a localização. Permita o acesso à localização e tente ao ar livre.");
      const c = best.coords;
      setLat(Number(c.latitude.toFixed(6)));
      setLng(Number(c.longitude.toFixed(6)));
      setMe({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy });
      if (c.accuracy > 30) toast.warning(`Posição obtida com pouca precisão (±${Math.round(c.accuracy)} m). Confirme o centro no mapa.`);
      else toast.success(`Posição obtida (±${Math.round(c.accuracy)} m).`);
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        if (p.coords.accuracy <= 10) finish();
      },
      () => finish(),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
    const timer = setTimeout(finish, 8000);
  };

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      const centerLat = Number(String(o.centerLat ?? "").replace(",", "."));
      const centerLng = Number(String(o.centerLng ?? "").replace(",", "."));
      const radiusM = Math.round(Number(o.radiusM));
      const maxAccuracyM = Math.round(Number(o.maxAccuracyM));
      const toleranceM = Math.round(Number(o.toleranceM ?? 0));
      if (!o.name || o.name.length < 3) throw new Error("Indique o nome do local.");
      if (!Number.isFinite(centerLat) || centerLat < -90 || centerLat > 90) throw new Error("Latitude inválida.");
      if (!Number.isFinite(centerLng) || centerLng < -180 || centerLng > 180) throw new Error("Longitude inválida.");
      if (!(radiusM >= 5 && radiusM <= 5000)) throw new Error("Raio entre 5 e 5000 m.");
      if (!(maxAccuracyM >= 10 && maxAccuracyM <= 500)) throw new Error("Precisão máxima entre 10 e 500 m.");
      if (!(toleranceM >= 0 && toleranceM <= 200)) throw new Error("Margem entre 0 e 200 m.");
      const values = {
        name: o.name,
        branch_id: o.branchId ?? null,
        center_lat: centerLat,
        center_lng: centerLng,
        radius_m: radiusM,
        max_accuracy_m: maxAccuracyM,
        active: o.active === "1",
      };
      const write = (v: Record<string, unknown>) =>
        location
          ? sb().from("work_locations").update(v).eq("id", location.id).select("id")
          : sb().from("work_locations").insert({ ...v, company_id: companyId }).select("id");
      let r = await write({ ...values, tolerance_m: toleranceM });
      // Sem o script 04_parte8.sql a coluna da margem ainda não existe: guarda o resto.
      if (r.error && /tolerance_m/.test(r.error.message)) r = await write(values);
      must(r);
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
          setTolerance(location?.tolerance_m ?? 0);
          setMe(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {location ? (
          <Button size="sm" variant="outline">Editar</Button>
        ) : (
          <Button>Novo local</Button>
        )}
      </DialogTrigger>
      <DialogContent title={location ? "Editar local" : "Novo local"} description="Toque no mapa ou arraste o ponto para definir o centro do perímetro." wide>
        <ActionForm action={save} onSuccess={() => setOpen(false)} resetOnSuccess={false} className="space-y-4">
          {open ? (
            <GeofenceMap
              lat={lat}
              lng={lng}
              radius={radius}
              tolerance={tolerance}
              me={me}
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
            <Field label="Precisão GPS máxima (m)" hint="Acima disto a marcação fica em revisão, salvo se a pessoa estiver claramente dentro.">
              <Input name="maxAccuracyM" type="number" min={10} max={500} defaultValue={location?.max_accuracy_m ?? 80} />
            </Field>
            <Field label={`Margem de tolerância: ${tolerance} m`} hint="Conta como dentro até esta distância além do limite (linha tracejada). Útil junto a paredes e edifícios altos.">
              <input
                type="range"
                name="toleranceM"
                min={0}
                max={100}
                step={5}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="accent-primary"
              />
            </Field>
            <Field label="Estado">
              <Select name="active" defaultValue={location && !location.active ? "0" : "1"}>
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={useMine} disabled={locating}>
              {locating ? <span className="spinner" aria-hidden /> : null}
              {locating ? "A obter a localização" : "Usar a minha localização"}
            </Button>
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

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      if (!o.name || o.name.length < 3) throw new Error("Indique o nome da estação.");
      const rotation = Math.round(Number(o.rotationSeconds ?? station?.rotation_seconds ?? 30));
      if (!(rotation >= 10 && rotation <= 300)) throw new Error("Rotação entre 10 e 300 segundos.");
      const values = { name: o.name, qr_mode: "dynamic", rotation_seconds: rotation };
      if (station) must(await sb().from("attendance_stations").update(values).eq("id", station.id).select("id"));
      else must(await sb().from("attendance_stations").insert({ ...values, company_id: companyId, location_id: locationId }).select("id"));
      onDone();
      return station ? "Estação actualizada." : "Estação criada.";
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {station ? (
          <Button size="sm" variant="ghost">Editar</Button>
        ) : (
          <Button size="sm" variant="outline" className="w-full">Adicionar estação</Button>
        )}
      </DialogTrigger>
      <DialogContent title={station ? "Editar estação" : "Nova estação de marcação"}>
        <ActionForm action={save} onSuccess={() => setOpen(false)} resetOnSuccess={!station} className="space-y-4">
          <Field label="Nome"><Input name="name" required placeholder="Ex.: Recepção" defaultValue={station?.name} /></Field>
          <Field label="O QR dinâmico muda a cada (segundos)" hint="O QR fixo impresso desta estação gere-se em QR Code.">
            <Input name="rotationSeconds" type="number" min={10} max={300} defaultValue={station?.rotation_seconds ?? 30} />
          </Field>
          <SubmitButton className="w-full">{station ? "Guardar estação" : "Criar estação"}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
