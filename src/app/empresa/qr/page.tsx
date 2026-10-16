"use client";

import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { NoAccess } from "@/components/company/p2-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { attempt, formObject } from "@/lib/result";
import { brandedQrSvg, svgToPngBlob } from "@/lib/qr-brand";
import { errorMessage, must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, withBase } from "@/lib/sb/use-data";

type Station = { id: string; name: string; location_id: string; active: boolean; window_start: string | null; window_end: string | null };
type Location = { id: string; name: string };
type FixedQr = { token: string; station: string; location: string; company: string; windowStart: string | null; windowEnd: string | null };
type ClockLink = { id: string; location_id: string; work_date: string; start_time: string; end_time: string; note: string | null; require_gps: boolean };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export default function QrPage() {
  const { can } = useCompany();
  if (!can("locations.manage")) return <NoAccess title="QR Code" />;
  return <QrManager />;
}

function QrManager() {
  const { companyId, tz } = useCompany();
  const data = useData(async () => {
    const [st, loc, links] = await Promise.all([
      sb().from("attendance_stations").select("id,name,location_id,active,window_start,window_end").eq("company_id", companyId).order("name"),
      sb().from("work_locations").select("id,name").eq("company_id", companyId).eq("active", true).order("name"),
      sb()
        .from("clock_links")
        .select("id,location_id,work_date,start_time,end_time,note,require_gps")
        .eq("company_id", companyId)
        .gte("work_date", new Date().toLocaleDateString("sv-SE", { timeZone: tz }))
        .order("work_date")
        .order("start_time"),
    ]);
    return {
      stations: must(st) as Station[],
      locations: must(loc) as Location[],
      links: (links.error ? [] : links.data) as ClockLink[],
      linksMissing: !!links.error,
    };
  }, [companyId, tz]);

  const [stationId, setStationId] = React.useState<string | null>(null);
  const stations = data.data?.stations.filter((s) => s.active) ?? [];
  const station = stations.find((s) => s.id === stationId) ?? stations[0];

  return (
    <>
      <PageHeader title="QR Code" description="O código fixo da empresa para marcar o ponto e as marcações por link em dias especiais." />
      <PageBody>
        {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
        {data.loading && !data.data ? (
          <Skeleton className="h-[420px] rounded-xl" />
        ) : !station ? (
          <EmptyState
            title="Ainda não há estação de marcação"
            description="Crie primeiro o local de trabalho e uma estação em Locais e estações. O QR Code fica ligado a essa estação."
            action={
              <Button asChild>
                <Link href="/empresa/locais/">Abrir Locais e estações</Link>
              </Button>
            }
          />
        ) : (
          <>
            {stations.length > 1 ? (
              <Field label="Estação" className="max-w-sm">
                <Select value={station.id} onChange={(e) => setStationId(e.target.value)}>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <FixedQrCard key={station.id} station={station} onChanged={data.reload} />
          </>
        )}

        {data.data ? (
          <LinksCard links={data.data.links} locations={data.data.locations} missing={data.data.linksMissing} onChanged={data.reload} tz={tz} />
        ) : null}
      </PageBody>
    </>
  );
}

/* ----------------------------- QR Code fixo ----------------------------- */

function FixedQrCard({ station, onChanged }: { station: Station; onChanged: () => void }) {
  const { company } = useCompany();
  const [qr, setQr] = React.useState<FixedQr | null>(null);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [always, setAlways] = React.useState(!station.window_start);

  const load = React.useCallback(
    async (renew = false) => {
      setBusy(true);
      setError(null);
      try {
        const r = await rpc<FixedQr>("ps_station_fixed_qr", { p_station: station.id, p_new: renew });
        setQr(r);
        const url = `${window.location.origin}${withBase(`/app/marcar/?t=${encodeURIComponent(r.token)}`)}`;
        const hours = r.windowStart && r.windowEnd ? `Marcações das ${r.windowStart} às ${r.windowEnd}` : "Marque a entrada e a saída aqui";
        setSvg(await brandedQrSvg({ url, company: r.company || company.companyName, subtitle: hours }));
        if (renew) toast.success("Novo QR Code gerado. O anterior deixou de funcionar.");
      } catch (e) {
        const msg = errorMessage(e);
        setError(/ps_station_fixed_qr|function/i.test(msg) ? "Falta activar o QR Code fixo: corra o script supabase/04_parte7.sql no Supabase." : msg);
      } finally {
        setBusy(false);
      }
    },
    [station.id, company.companyName],
  );

  React.useEffect(() => {
    void load(false);
  }, [load]);

  const saveWindow = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      const start = always ? null : o.start || null;
      const end = always ? null : o.end || null;
      await rpc("ps_station_set_window", { p_station: station.id, p_start: start, p_end: end });
      onChanged();
      await load(false);
      return { ok: true, message: start ? `O QR Code aceita marcações das ${start} às ${end}.` : "O QR Code aceita marcações a qualquer hora." };
    });

  const download = async () => {
    if (!svg) return;
    try {
      const blob = await svgToPngBlob(svg, 3);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `QR-Horbit-${(qr?.company ?? "empresa").replace(/[^\p{L}\p{N}]+/gu, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const print = () => {
    if (!svg) return;
    const w = window.open("", "_blank", "width=640,height=860");
    if (!w) return void toast.error("Permita janelas pop-up para imprimir.");
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>QR Code Horbit</title><style>@page{margin:12mm}body{margin:0;display:flex;justify-content:center}svg{width:150mm;height:auto}</style></head><body>${svg}</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex items-center justify-center border-b border-border bg-surface p-5 lg:border-r lg:border-b-0">
          {svg ? (
            <div className="w-full max-w-[320px] [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <Skeleton className="aspect-[3/4] w-full max-w-[320px] rounded-xl" />
          )}
        </div>
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <h2 className="text-[17px] font-bold">QR Code fixo de {station.name}</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              Imprima e afixe na entrada. O código é sempre o mesmo. O colaborador aponta a câmara do telemóvel, o Horbit abre e marca o
              ponto sozinho: primeiro a entrada, depois a saída.
            </p>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={print} disabled={!svg}>
              Imprimir
            </Button>
            <Button variant="outline" onClick={download} disabled={!svg}>
              Descarregar imagem
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Gerar um código novo? O QR Code impresso deixa de funcionar e terá de imprimir o novo.")) void load(true);
              }}
            >
              {busy ? <span className="spinner" aria-hidden /> : null}
              Gerar código novo
            </Button>
          </div>

          <ActionForm action={saveWindow} resetOnSuccess={false} className="space-y-3 border-t border-border pt-5">
            <div>
              <h3 className="text-[15px] font-bold">Horário do QR Code</h3>
              <p className="mt-0.5 text-[13px] text-muted">Fora deste horário o código não regista marcações. Inclua a hora de saída.</p>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 text-[14px] font-medium">
              <Checkbox checked={always} onChange={(e) => setAlways(e.target.checked)} />
              Aceitar marcações a qualquer hora
            </label>
            {always ? null : (
              <div className="grid max-w-sm grid-cols-2 gap-3">
                <Field label="Das">
                  <Input type="time" name="start" required defaultValue={hhmm(station.window_start) ?? "06:30"} />
                </Field>
                <Field label="Às">
                  <Input type="time" name="end" required defaultValue={hhmm(station.window_end) ?? "18:30"} />
                </Field>
              </div>
            )}
            <SubmitButton variant="outline">Guardar horário</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------ Marcação por link ------------------------ */

function LinksCard({
  links,
  locations,
  missing,
  onChanged,
  tz,
}: {
  links: ClockLink[];
  locations: Location[];
  missing: boolean;
  onChanged: () => void;
  tz: string;
}) {
  const { companyId } = useCompany();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Local";

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      await rpc("ps_clock_link_save", {
        p_company: companyId,
        p_id: null,
        p_location: o.location,
        p_date: o.date,
        p_start: o.start,
        p_end: o.end,
        p_note: o.note ?? null,
        p_require_gps: fd.get("gps") === "on",
      });
      onChanged();
      return { ok: true, message: "Marcação por link criada. Os colaboradores vêem o botão no painel durante esse horário." };
    });

  const remove = async (l: ClockLink) => {
    if (!window.confirm("Remover esta marcação por link?")) return;
    try {
      await rpc("ps_clock_link_delete", { p_id: l.id });
      toast.success("Marcação por link removida.");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Marcação por link (dias especiais)</CardTitle>
          <CardDescription>
            Para dias com horário diferente: no dia e horas escolhidos aparece um botão &quot;Marcar ponto&quot; no painel dos colaboradores, sem
            precisar do QR Code.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {missing ? (
          <Notice tone="warning">Corra o script supabase/04_parte7.sql no Supabase para activar a marcação por link.</Notice>
        ) : null}
        {links.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold tabular">
                    {l.work_date === today ? "Hoje" : new Date(`${l.work_date}T12:00:00`).toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}
                    , das {hhmm(l.start_time)} às {hhmm(l.end_time)}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {locName(l.location_id)}
                    {l.note ? `, ${l.note}` : ""}
                    {l.require_gps ? "" : ", sem verificação de localização"}
                  </p>
                </div>
                {l.work_date === today ? <Badge tone="success">Hoje</Badge> : <Badge>Agendada</Badge>}
                <Button size="sm" variant="ghost" onClick={() => remove(l)}>
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted">Nenhuma marcação por link agendada.</p>
        )}

        {locations.length ? (
          <ActionForm action={save} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-[14px] font-bold sm:col-span-2 lg:col-span-4">Nova marcação por link</p>
            <Field label="Dia">
              <Input type="date" name="date" required min={today} defaultValue={today} />
            </Field>
            <Field label="Das">
              <Input type="time" name="start" required defaultValue="08:00" />
            </Field>
            <Field label="Às">
              <Input type="time" name="end" required defaultValue="17:30" />
            </Field>
            <Field label="Local">
              <Select name="location" required defaultValue={locations[0]?.id}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motivo (opcional)" className="sm:col-span-2">
              <Input name="note" maxLength={200} placeholder="Ex.: inventário, entrada às 08:00" />
            </Field>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 self-end text-[14px] font-medium sm:col-span-2">
              <Checkbox name="gps" defaultChecked />
              Exigir que estejam no local (GPS)
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Criar marcação por link</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
      </CardContent>
    </Card>
  );
}
