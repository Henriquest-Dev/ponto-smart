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

type Station = {
  id: string;
  name: string;
  location_id: string;
  active: boolean;
  rotation_seconds: number;
  window_start: string | null;
  window_end: string | null;
};
type Location = { id: string; name: string };
type FixedQr = { token: string; station: string; location: string; company: string; windowStart: string | null; windowEnd: string | null };
type ClockLink = { id: string; location_id: string; work_date: string; start_time: string; end_time: string; note: string | null; require_gps: boolean };
type DailyLink = { id: string; stationId: string; station: string; location: string; date: string; start: string; end: string; shown: boolean; open: boolean };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const linkUrl = (id: string) => (typeof window === "undefined" ? "" : `${window.location.origin}${withBase(`/app/marcar/?link=${id}`)}`);

/** Link para copiar ou enviar (WhatsApp / partilha do telemóvel). */
function ShareLink({
  url,
  label,
  hint,
  message,
  compact,
  copyOnly,
}: {
  url: string;
  label?: string;
  hint?: string;
  message: string;
  compact?: boolean;
  /** Só copiar (sem WhatsApp nem partilha). */
  copyOnly?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Seleccione o link e copie manualmente.");
    }
  };
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className={compact ? "mt-1" : "space-y-1.5"}>
      {label ? <p className="text-[13.5px] font-bold">{label}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 font-mono text-[12.5px] sm:h-9 sm:flex-1" aria-label="Link" />
        <div className="flex gap-2">
          <Button size="sm" variant={copied ? "outline" : "primary"} onClick={copy}>
            {copied ? "Copiado" : "Copiar link"}
          </Button>
          {copyOnly ? null : (
            <Button size="sm" variant="outline" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                Enviar por WhatsApp
              </a>
            </Button>
          )}
          {canShare && !copyOnly ? (
            <Button size="sm" variant="ghost" onClick={() => void navigator.share({ text: message }).catch(() => undefined)}>
              Partilhar
            </Button>
          ) : null}
        </div>
      </div>
      {hint ? <p className="text-[12.5px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export default function QrPage() {
  const { can } = useCompany();
  if (!can("locations.manage")) return <NoAccess title="QR Code" />;
  return <QrManager />;
}

function QrManager() {
  const { companyId, tz } = useCompany();
  const data = useData(async () => {
    const [st, loc, links, daily] = await Promise.all([
      sb().from("attendance_stations").select("id,name,location_id,active,rotation_seconds,window_start,window_end").eq("company_id", companyId).order("name"),
      sb().from("work_locations").select("id,name").eq("company_id", companyId).eq("active", true).order("name"),
      sb()
        .from("clock_links")
        .select("id,location_id,work_date,start_time,end_time,note,require_gps")
        .eq("company_id", companyId)
        .eq("kind", "manual")
        .gte("work_date", new Date().toLocaleDateString("sv-SE", { timeZone: tz }))
        .order("work_date")
        .order("start_time"),
      rpc<DailyLink[]>("ps_daily_links", { p_company: companyId }).then(
        (d) => ({ list: d ?? [], missing: false }),
        () => ({ list: [] as DailyLink[], missing: true }),
      ),
    ]);
    return {
      daily: daily.list,
      dailyMissing: daily.missing,
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
      <PageHeader title="QR Code" description="QR dinâmico no ecrã da entrada, QR fixo impresso e, se o QR falhar, o link de reserva do dia." />
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
            <DynamicQrCard station={station} />
            <FixedQrCard key={station.id} station={station} onChanged={data.reload} />
            {data.data ? (
              <DailyLinkCard
                link={data.data.daily.find((d) => d.stationId === station.id) ?? null}
                missing={data.data.dailyMissing}
                onChanged={data.reload}
              />
            ) : null}
          </>
        )}

        {data.data?.links.length ? <LinksCard links={data.data.links} locations={data.data.locations} onChanged={data.reload} tz={tz} /> : null}
      </PageBody>
    </>
  );
}

/* ----------------------------- QR Code dinâmico ----------------------------- */

function DynamicQrCard({ station }: { station: Station }) {
  const { can } = useCompany();
  const screen = typeof window === "undefined" ? "" : `${window.location.origin}${withBase(`/estacao/?id=${station.id}`)}`;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>QR Code dinâmico de {station.name}</CardTitle>
          <CardDescription>
            Para um tablet ou computador na entrada. O código muda a cada {station.rotation_seconds || 30} segundos, por isso uma fotografia
            do código não serve para marcar fora do local. É a opção mais segura; o colaborador lê o código no Horbit, em Marcar ponto.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {can("stations.display") ? (
          <Button asChild>
            <a href={withBase(`/estacao/?id=${station.id}`)} target="_blank" rel="noreferrer">
              Abrir ecrã do QR dinâmico
            </a>
          </Button>
        ) : (
          <Notice tone="info">O seu papel não permite abrir o ecrã da estação. Peça a quem gere a empresa.</Notice>
        )}
        <ShareLink
          url={screen}
          copyOnly
          label="Link do ecrã"
          message={screen}
          hint="Abra este link no tablet da entrada, com a sua conta. O ecrã fica em ecrã inteiro e renova o código sozinho."
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------ Link de reserva do dia ------------------------ */

function DailyLinkCard({ link, missing, onChanged }: { link: DailyLink | null; missing: boolean; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const day = link ? new Date(`${link.date}T12:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }) : "";
  const url = link ? linkUrl(link.id) : "";
  const allDay = link?.start === "00:00" && link?.end === "23:59";
  const hours = link ? (allDay ? "durante todo o dia" : `das ${link.start} às ${link.end}`) : "";

  const toggle = async (shown: boolean) => {
    if (!link) return;
    setBusy(true);
    try {
      await rpc("ps_daily_link_show", { p_link: link.id, p_shown: shown });
      toast.success(shown ? "O botão Marcar ponto aparece hoje no painel dos colaboradores." : "O botão deixou de aparecer aos colaboradores.");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Link de reserva de hoje</CardTitle>
          <CardDescription>
            Só para quando o QR Code falha: ecrã desligado, sem internet na entrada, código danificado ou câmara avariada. É criado
            automaticamente todos os dias e deixa de funcionar no fim do dia; amanhã há um link novo.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {missing ? (
          <Notice tone="warning">Corra o script supabase/04_parte8.sql no Supabase para activar o link de reserva diário.</Notice>
        ) : !link ? (
          <p className="text-[13.5px] text-muted">A estação está inactiva, por isso não há link de reserva.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14.5px] font-bold tabular">
                Válido hoje, {day}, {hours}
              </p>
              {link.open ? <Badge tone="success">Aberto agora</Badge> : <Badge>Fora do horário</Badge>}
            </div>
            <ShareLink
              url={url}
              message={`O QR Code está com problemas hoje. Marque o ponto no Horbit por este link (válido só hoje, ${day}, ${hours}): ${url}`}
              hint="Quem abrir o link entra no Horbit e marca o ponto. A localização continua a ser verificada e a marcação fica identificada como feita por link."
            />
            <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-xl border border-border p-3.5 text-[14px]">
              <Checkbox className="mt-0.5" checked={link.shown} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
              <span>
                <span className="block font-bold">Mostrar o botão Marcar ponto aos colaboradores hoje</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                  Em vez de enviar o link, o botão aparece no painel de cada colaborador até ao fim do dia. Amanhã volta a ficar desligado.
                </span>
              </span>
            </label>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- QR Code fixo ----------------------------- */

function FixedQrCard({ station, onChanged }: { station: Station; onChanged: () => void }) {
  const { company } = useCompany();
  const [qr, setQr] = React.useState<FixedQr | null>(null);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
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
        setUrl(url);
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
          {url ? (
            <ShareLink
              url={url}
              label="Link do QR Code"
              hint="Faz o mesmo que ler o QR Code: quem abrir o link entra no Horbit e marca o ponto, dentro do horário e no local de trabalho."
              message={`Marque o ponto no Horbit (${company.companyName}): ${url}`}
            />
          ) : null}
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

/* ------------------- Marcações por link agendadas (dias especiais) ------------------- */

function LinksCard({ links, locations, onChanged, tz }: { links: ClockLink[]; locations: Location[]; onChanged: () => void; tz: string }) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Local";

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
          <CardTitle>Marcações por link agendadas</CardTitle>
          <CardDescription>Criadas pelo assistente para dias especiais. No dia e horas indicados aparece o botão Marcar ponto aos colaboradores.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
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
              <div className="w-full">
                <ShareLink
                  url={linkUrl(l.id)}
                  compact
                  message={`Marcação de ponto no Horbit em ${new Date(`${l.work_date}T12:00:00`).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}, das ${hhmm(l.start_time)} às ${hhmm(l.end_time)}: ${linkUrl(l.id)}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
