import { CalendarX2 } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { MonthPicker } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { requireEmployee } from "@/lib/auth/context";
import { formatMinutes, formatTime } from "@/lib/format";
import { EVENT_STATUS, EVENT_TYPE_LABEL, GEOFENCE_LABEL, dailyStatus } from "@/lib/labels";
import { monthDays, monthEvents, summarize } from "@/lib/queries/employee";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "Histórico" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await requireEmployee();
  const tz = ctx.company.timezone;
  const current = localDate(new Date(), tz).slice(0, 7);
  const { mes } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) && mes <= current ? mes : current;
  const [y, m] = month.split("-").map(Number);
  const [days, events] = await Promise.all([
    monthDays(ctx.company.id, ctx.employee.id, y, m),
    monthEvents(ctx.company.id, ctx.employee.id, y, m),
  ]);
  const s = summarize(days);

  return (
    <>
      <PageHeader
        title="Histórico"
        description="As suas marcações e a situação de cada dia."
        actions={<MonthPicker value={month} max={current} hrefFor={(v) => `/app/historico?mes=${v}`} />}
      />
      <PageBody className="mx-auto max-w-5xl">
        <StatRow>
          <Stat label="Dias trabalhados" value={s.workedDays} />
          <Stat label="Horas" value={formatMinutes(s.workedMinutes)} />
          <Stat label="Atrasos" value={s.late} />
          <Stat label="Faltas" value={s.absences} hint={s.justified ? `${s.justified} justificadas` : undefined} />
        </StatRow>

        {days.length === 0 ? (
          <EmptyState icon={<CalendarX2 />} title="Sem registos neste mês" description="Quando marcar ponto, os dias aparecem aqui." />
        ) : (
          <ul className="overflow-hidden rounded-xl border border-border">
            {days.map((d) => {
              const st = dailyStatus(d.status);
              const dayEvents = events.filter((e) => e.workDate === d.workDate);
              const date = new Date(`${d.workDate}T12:00:00Z`);
              return (
                <li key={d.id} className="border-b border-border last:border-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3.5 hover:bg-surface/60 sm:px-5 [&::-webkit-details-marker]:hidden">
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface py-1.5">
                        <span className="text-[10px] text-muted uppercase">{date.toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" }).replace(".", "")}</span>
                        <span className="text-[17px] leading-tight font-semibold tabular">{date.getUTCDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium tabular">
                          {d.firstIn ? formatTime(d.firstIn, tz) : "—"} <span className="text-subtle">→</span> {d.lastOut ? formatTime(d.lastOut, tz) : "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatMinutes(d.workedMinutes)} trabalhadas
                          {d.lateMinutes ? ` · ${d.lateMinutes} min de atraso` : ""}
                          {d.overtimeMinutes ? ` · ${formatMinutes(d.overtimeMinutes)} extra` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </summary>
                    {dayEvents.length ? (
                      <ul className="space-y-2 border-t border-border bg-surface/40 px-4 py-3 sm:px-5">
                        {dayEvents.map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                            <span className="w-12 font-medium tabular">{formatTime(e.occurredAt, tz)}</span>
                            <span className="min-w-28">{EVENT_TYPE_LABEL[e.type]}</span>
                            <span className="text-xs text-muted">
                              {e.station ?? "—"}
                              {e.geofence ? ` · ${GEOFENCE_LABEL[e.geofence]}` : ""}
                              {e.accuracy ? ` (±${Math.round(e.accuracy)} m)` : ""}
                            </span>
                            {e.status !== "accepted" ? <Badge tone={EVENT_STATUS[e.status].tone} className="ml-auto">{EVENT_STATUS[e.status].label}</Badge> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
