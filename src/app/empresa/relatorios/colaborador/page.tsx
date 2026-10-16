"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { exportEmployeeReport, type EmployeeReportDay } from "@/components/company/p2-reports";
import { ErrorBlock, fetchAll, LoadingBlock, monthBounds, NoAccess, todayIn } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { MonthPicker } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { DailyStatus, EventType } from "@/lib/domain/attendance-rules";
import { formatMinutes, formatTime, periodLabel } from "@/lib/format";
import { dailyStatus } from "@/lib/labels";
import { attempt } from "@/lib/result";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { daysBetween, isoWeekday } from "@/lib/time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Esconde a navegação da aplicação ao imprimir. */
const PRINT_CSS = `@media print {
  aside, header.sticky, nav[aria-label="Navegação rápida"] { display: none !important; }
  main { padding-bottom: 0 !important; }
  html, body, .bg-canvas { background: #fff !important; }
  table { min-width: 0 !important; font-size: 11px; }
  tr { break-inside: avoid; }
  @page { margin: 14mm; }
}`;

type Employee = { id: string; full_name: string; employee_code: string; job_title: string | null; status: string; departments: { name: string } | null };
type Daily = {
  work_date: string;
  status: DailyStatus;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  break_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
};
type Ev = { type: EventType; occurred_at: string; work_date: string };
type Day = {
  date: string;
  weekday: string;
  firstIn: string | null;
  lastOut: string | null;
  breaks: number;
  breakMinutes: number;
  worked: number;
  late: number;
  overtime: number;
  status: DailyStatus | null;
};

export default function EmployeeReportPage() {
  const { can } = useCompany();
  if (!can("reports.view")) return <NoAccess title="Relatório do colaborador" />;
  return <EmployeeReport />;
}

function EmployeeReport() {
  const { companyId, tz, can, company } = useCompany();
  const router = useRouter();
  const id = useQueryParam("id");
  const mesParam = useQueryParam("mes");
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);
  const initial = mesParam && YM.test(mesParam) && mesParam <= thisMonth ? mesParam : thisMonth;
  const [month, setMonth] = React.useState(initial);
  const valid = !!id && UUID.test(id);

  const changeMonth = (m: string) => {
    setMonth(m);
    if (id) router.replace(`/empresa/relatorios/colaborador/?id=${id}&mes=${m}`, { scroll: false });
  };

  const emp = useData(async () => {
    if (!valid) return null;
    return must(
      await sb()
        .from("employees")
        .select("id,full_name,employee_code,job_title,status,departments(name)")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle(),
    ) as unknown as Employee | null;
  }, [id, companyId, valid]);

  const days = useData(async () => {
    if (!valid) return [] as Day[];
    const { from, to } = monthBounds(month);
    const [daily, events] = await Promise.all([
      fetchAll(() =>
        sb()
          .from("attendance_daily")
          .select("work_date,status,first_in,last_out,worked_minutes,break_minutes,late_minutes,overtime_minutes")
          .eq("company_id", companyId)
          .eq("employee_id", id)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date")
          .order("id"),
      ),
      fetchAll(() =>
        sb()
          .from("attendance_events")
          .select("type,occurred_at,work_date")
          .eq("company_id", companyId)
          .eq("employee_id", id)
          .in("status", ["accepted", "review"])
          .gte("work_date", from)
          .lte("work_date", to)
          .order("occurred_at")
          .order("id"),
      ),
    ]);
    const byDay = new Map((daily as Daily[]).map((d) => [d.work_date, d]));
    const evByDay = new Map<string, Ev[]>();
    for (const e of events as Ev[]) {
      const list = evByDay.get(e.work_date) ?? [];
      list.push(e);
      evByDay.set(e.work_date, list);
    }
    const last = to < today ? to : today;
    return daysBetween(from, last).map((date): Day => {
      const d = byDay.get(date);
      const evs = evByDay.get(date) ?? [];
      const firstIn = evs.find((e) => e.type === "in")?.occurred_at ?? d?.first_in ?? null;
      const lastOut = [...evs].reverse().find((e) => e.type === "out")?.occurred_at ?? d?.last_out ?? null;
      let breaks = 0;
      let breakMinutes = 0;
      let openBreak: number | null = null;
      for (const e of evs) {
        if (e.type === "break_start") {
          breaks++;
          openBreak = new Date(e.occurred_at).getTime();
        } else if (e.type === "break_end" && openBreak != null) {
          breakMinutes += Math.round((new Date(e.occurred_at).getTime() - openBreak) / 60000);
          openBreak = null;
        }
      }
      return {
        date,
        weekday: WEEKDAYS[isoWeekday(date) - 1],
        firstIn,
        lastOut,
        breaks,
        breakMinutes: d?.break_minutes || breakMinutes,
        worked: d?.worked_minutes ?? 0,
        late: d?.late_minutes ?? 0,
        overtime: d?.overtime_minutes ?? 0,
        status: d?.status ?? null,
      };
    });
  }, [id, companyId, valid, month, today]);

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/empresa/relatorios/">Voltar aos relatórios</Link>
    </Button>
  );

  if (!valid || (!emp.loading && !emp.error && !emp.data)) {
    return (
      <>
        <PageHeader title="Relatório do colaborador" actions={back} />
        <PageBody>
          <EmptyState title="Colaborador não encontrado" description="O registo não existe ou não pertence à sua equipa." />
        </PageBody>
      </>
    );
  }
  if (emp.error) {
    return (
      <>
        <PageHeader title="Relatório do colaborador" actions={back} />
        <PageBody>
          <ErrorBlock message={emp.error} />
        </PageBody>
      </>
    );
  }
  if (!emp.data) {
    return (
      <>
        <div className="px-4 pt-6 pb-2 sm:px-6 lg:px-8">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full rounded-lg" />
        </div>
        <PageBody>
          <LoadingBlock rows={4} />
        </PageBody>
      </>
    );
  }

  const e = emp.data;
  const list = days.data ?? [];
  const count = (...st: DailyStatus[]) => list.filter((d) => d.status && st.includes(d.status)).length;
  const lateDays = list.filter((d) => d.status === "late");
  const s = {
    workedDays: list.filter((d) => d.firstIn).length,
    scheduled: list.filter((d) => d.status && d.status !== "holiday" && d.status !== "day_off").length,
    worked: list.reduce((a, d) => a + d.worked, 0),
    overtime: list.reduce((a, d) => a + d.overtime, 0),
    late: lateDays.length,
    lateMinutes: lateDays.reduce((a, d) => a + d.late, 0),
    justified: count("justified"),
    unjustified: count("unjustified"),
    pending: count("absent_pending", "incomplete", "review"),
    breakMinutes: list.reduce((a, d) => a + d.breakMinutes, 0),
  };
  const [y, m] = month.split("-").map(Number);
  const period = periodLabel(y, m);
  const meta = [`Nº ${e.employee_code}`, e.job_title ?? "Sem função", e.departments?.name ?? "Sem departamento"].join(", ");

  const download = () =>
    attempt(async () => {
      const rows: EmployeeReportDay[] = list.map((d) => ({
        date: d.date,
        weekday: d.weekday,
        in: d.firstIn ? formatTime(d.firstIn, tz) : "",
        out: d.lastOut ? formatTime(d.lastOut, tz) : "",
        breakMinutes: d.breakMinutes,
        workedMinutes: d.worked,
        lateMinutes: d.late,
        overtimeMinutes: d.overtime,
        status: d.status ? dailyStatus(d.status).label : "Sem registo",
      }));
      await exportEmployeeReport(
        companyId,
        company.companyName,
        { id: e.id, name: e.full_name, code: e.employee_code, department: e.departments?.name ?? "", jobTitle: e.job_title ?? "" },
        month,
        [
          ["Mês", period],
          ["Dias trabalhados", s.workedDays],
          ["Horas trabalhadas", formatMinutes(s.worked)],
          ["Horas extra", formatMinutes(s.overtime)],
          ["Dias com atraso", s.late],
          ["Minutos de atraso", s.lateMinutes],
          ["Faltas justificadas", s.justified],
          ["Faltas injustificadas", s.unjustified],
          ["Por regularizar", s.pending],
          ["Intervalos", formatMinutes(s.breakMinutes)],
        ],
        rows,
      );
    });

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={e.full_name}
        description={meta}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {back}
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!days.data}>
              Imprimir
            </Button>
            {can("reports.export") ? (
              <ActionButton variant="outline" size="sm" action={download} disabled={!days.data}>
                Descarregar Excel
              </ActionButton>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">Relatório de assiduidade, {period}</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {company.companyName}
              {e.status !== "active" ? ", colaborador inactivo" : ""}
            </p>
          </div>
          <div className="print:hidden">
            <MonthPicker value={month} onChange={changeMonth} max={thisMonth} />
          </div>
        </div>

        {days.error ? (
          <ErrorBlock message={days.error} />
        ) : days.loading && !days.data ? (
          <LoadingBlock rows={5} />
        ) : (
          <>
            <div className="space-y-3">
              <StatRow>
                <Stat label="Dias trabalhados" value={s.workedDays} hint={`${s.scheduled} dias com horário`} />
                <Stat label="Horas trabalhadas" value={formatMinutes(s.worked)} />
                <Stat label="Horas extra" value={formatMinutes(s.overtime)} hint="Sujeitas a validação" />
                <Stat label="Atrasos" value={s.late} hint={`${s.lateMinutes} min no total`} />
              </StatRow>
              <StatRow>
                <Stat label="Faltas justificadas" value={s.justified} />
                <Stat label="Faltas injustificadas" value={s.unjustified} />
                <Stat label="Por regularizar" value={s.pending} hint="Faltas pendentes e registos incompletos" />
                <Stat label="Intervalos" value={formatMinutes(s.breakMinutes)} />
              </StatRow>
            </div>

            {list.length === 0 ? (
              <EmptyState title="Sem dias para mostrar neste mês" />
            ) : (
              <>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden print:hidden">
                  {list.map((d) => (
                    <li key={d.date} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold tabular">
                          {d.weekday}, {d.date.slice(8)}/{d.date.slice(5, 7)}
                        </p>
                        <p className="text-[12.5px] text-muted tabular">
                          {d.firstIn ? `${formatTime(d.firstIn, tz)}–${d.lastOut ? formatTime(d.lastOut, tz) : "sem saída"}` : "Sem marcações"}
                          {d.breakMinutes ? `, intervalo ${formatMinutes(d.breakMinutes)}` : ""}
                          {d.worked ? `, ${formatMinutes(d.worked)}` : ""}
                        </p>
                      </div>
                      <StatusCell day={d} />
                    </li>
                  ))}
                </ul>
                <TableWrap className="hidden md:block print:block">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Data</TH>
                        <TH>Entrada</TH>
                        <TH>Saída</TH>
                        <TH>Intervalos</TH>
                        <TH>Trabalhado</TH>
                        <TH>Extra</TH>
                        <TH>Estado</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {list.map((d) => (
                        <TR key={d.date} className={d.status === "holiday" || d.status === "day_off" ? "bg-surface" : undefined}>
                          <TD className="font-bold whitespace-nowrap tabular">
                            <span className="inline-block w-9 font-medium text-muted">{d.weekday}</span>
                            {d.date.slice(8)}/{d.date.slice(5, 7)}
                          </TD>
                          <TD className="tabular">{d.firstIn ? formatTime(d.firstIn, tz) : <span className="text-subtle">—</span>}</TD>
                          <TD className="tabular">{d.lastOut ? formatTime(d.lastOut, tz) : <span className="text-subtle">—</span>}</TD>
                          <TD className="tabular">
                            {d.breakMinutes || d.breaks ? (
                              <span>
                                {formatMinutes(d.breakMinutes)}
                                {d.breaks > 1 ? <span className="text-[12px] text-muted"> ({d.breaks})</span> : null}
                              </span>
                            ) : (
                              <span className="text-subtle">—</span>
                            )}
                          </TD>
                          <TD className="font-bold tabular">{d.worked ? formatMinutes(d.worked) : <span className="font-normal text-subtle">—</span>}</TD>
                          <TD className="tabular">{d.overtime ? formatMinutes(d.overtime) : <span className="text-subtle">—</span>}</TD>
                          <TD>
                            <StatusCell day={d} />
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

function StatusCell({ day }: { day: Day }) {
  if (!day.status) return <span className="text-[12.5px] whitespace-nowrap text-subtle">Sem registo</span>;
  const st = dailyStatus(day.status);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Badge tone={st.tone}>{st.label}</Badge>
      {day.late ? <span className="text-[12px] font-bold text-warning tabular">+{day.late} min</span> : null}
    </span>
  );
}
