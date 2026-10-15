"use client";

import { CalendarX2 } from "lucide-react";
import { useState } from "react";
import { loadMonthDays, one, summarize, useTitle, type EventStatus, type One } from "@/components/collab/shared";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { MonthPicker, currentMonth } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import type { EventType } from "@/lib/domain/attendance-rules";
import { formatMinutes, formatTime } from "@/lib/format";
import { EVENT_STATUS, EVENT_TYPE_LABEL, GEOFENCE_LABEL, dailyStatus } from "@/lib/labels";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { monthRange } from "@/lib/time";

type EventRow = {
  id: string;
  type: EventType;
  occurred_at: string;
  work_date: string;
  status: EventStatus;
  reason: string | null;
  attendance_stations: One<{ name: string }>;
  attendance_validations: One<{ geofence_result: string; accuracy_m: string | number | null }>;
};

export default function HistoryPage() {
  useTitle("Histórico");
  const { company, companyId, tz } = useCompany();
  const employeeId = company.employeeId!;
  const current = currentMonth(tz);
  const [month, setMonth] = useState(current);

  const { data, error, loading } = useData(async () => {
    const [y, m] = month.split("-").map(Number);
    const { from, to } = monthRange(y, m);
    const [days, events] = await Promise.all([
      loadMonthDays(companyId, employeeId, month),
      sb()
        .from("attendance_events")
        .select("id,type,occurred_at,work_date,status,reason,attendance_stations(name),attendance_validations(geofence_result,accuracy_m)")
        .eq("company_id", companyId)
        .eq("employee_id", employeeId)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("occurred_at", { ascending: true })
        .then(must),
    ]);
    return { days, events: (events ?? []) as unknown as EventRow[] };
  }, [companyId, employeeId, month]);

  const s = data ? summarize(data.days) : null;

  return (
    <>
      <PageHeader
        title="Histórico"
        description="As suas marcações e a situação de cada dia."
        actions={<MonthPicker value={month} onChange={setMonth} max={current} />}
      />
      <PageBody className="mx-auto max-w-5xl">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {s ? (
          <StatRow>
            <Stat label="Dias trabalhados" value={s.workedDays} />
            <Stat label="Horas" value={formatMinutes(s.workedMinutes)} />
            <Stat label="Atrasos" value={s.late} />
            <Stat label="Faltas" value={s.absences} hint={s.justified ? `${s.justified} justificadas` : undefined} />
          </StatRow>
        ) : null}

        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : data && data.days.length === 0 ? (
          <EmptyState icon={<CalendarX2 />} title="Sem registos neste mês" description="Quando marcar ponto, os dias aparecem aqui." />
        ) : data ? (
          <ul className={loading ? "overflow-hidden rounded-xl border border-border opacity-60" : "overflow-hidden rounded-xl border border-border"}>
            {data.days.map((d) => {
              const st = dailyStatus(d.status);
              const dayEvents = data.events.filter((e) => e.work_date === d.work_date);
              const date = new Date(`${d.work_date}T12:00:00Z`);
              return (
                <li key={d.id} className="border-b border-border last:border-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3.5 hover:bg-surface/60 sm:px-5 [&::-webkit-details-marker]:hidden">
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface py-1.5">
                        <span className="text-[10px] text-muted uppercase">
                          {date.toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" }).replace(".", "")}
                        </span>
                        <span className="text-[17px] leading-tight font-semibold tabular">{date.getUTCDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium tabular">
                          {d.first_in ? formatTime(d.first_in, tz) : "—"} <span className="text-subtle">→</span>{" "}
                          {d.last_out ? formatTime(d.last_out, tz) : "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatMinutes(d.worked_minutes)} trabalhadas
                          {d.late_minutes ? ` · ${d.late_minutes} min de atraso` : ""}
                          {d.overtime_minutes ? ` · ${formatMinutes(d.overtime_minutes)} extra` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </summary>
                    {dayEvents.length ? (
                      <ul className="space-y-2 border-t border-border bg-surface/40 px-4 py-3 sm:px-5">
                        {dayEvents.map((e) => {
                          const v = one(e.attendance_validations);
                          const station = one(e.attendance_stations);
                          const accuracy = v?.accuracy_m != null ? Number(v.accuracy_m) : null;
                          return (
                            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                              <span className="w-12 font-medium tabular">{formatTime(e.occurred_at, tz)}</span>
                              <span className="min-w-28">{EVENT_TYPE_LABEL[e.type]}</span>
                              <span className="text-xs text-muted">
                                {station?.name ?? "—"}
                                {v?.geofence_result ? ` · ${GEOFENCE_LABEL[v.geofence_result] ?? v.geofence_result}` : ""}
                                {accuracy ? ` (±${Math.round(accuracy)} m)` : ""}
                              </span>
                              {e.status !== "accepted" ? (
                                <Badge tone={EVENT_STATUS[e.status].tone} className="ml-auto">
                                  {EVENT_STATUS[e.status].label}
                                </Badge>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PageBody>
    </>
  );
}
