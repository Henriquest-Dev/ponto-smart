"use client";

import Link from "next/link";
import * as React from "react";
import { Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { exportAttendance, exportEmployees, exportPayrollRun } from "@/components/company/p2-reports";
import { employeeReportHref, ErrorBlock, fetchAll, monthBounds, NoAccess, todayIn } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MonthPicker, shiftMonth } from "@/components/ui/month-picker";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMinutes, formatMoney, MONTHS_PT } from "@/lib/format";
import { RUN_STATUS } from "@/lib/labels";
import { attempt } from "@/lib/result";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

export default function ReportsPage() {
  const { can } = useCompany();
  if (!can("reports.view")) return <NoAccess title="Relatórios" />;
  return <Reports />;
}

type Daily = { work_date: string; status: string; worked_minutes: number; overtime_minutes: number };
type RunRow = { id: string; version: number; status: string; totals: { net: string } | null; payroll_periods: { year: number; month: number } | null };

function Reports() {
  const { companyId, can, tz, company } = useCompany();
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const exp = can("reports.export");

  const stats = useData(async () => {
    const start = `${shiftMonth(thisMonth, -5)}-01`;
    const rows = await fetchAll(() =>
      sb()
        .from("attendance_daily")
        .select("work_date,status,worked_minutes,overtime_minutes")
        .eq("company_id", companyId)
        .gte("work_date", start)
        .lte("work_date", today)
        .order("work_date")
        .order("id"),
    );
    const byMonth = new Map<string, { onTime: number; late: number; absent: number; scheduled: number; hours: number; overtime: number }>();
    for (let i = 5; i >= 0; i--) byMonth.set(shiftMonth(thisMonth, -i), { onTime: 0, late: 0, absent: 0, scheduled: 0, hours: 0, overtime: 0 });
    for (const r of rows as Daily[]) {
      const m = byMonth.get(r.work_date.slice(0, 7));
      if (!m) continue;
      if (r.status === "on_time") m.onTime++;
      if (r.status === "late") m.late++;
      if (r.status === "absent_pending" || r.status === "unjustified" || r.status === "justified") m.absent++;
      if (r.status !== "holiday" && r.status !== "day_off") m.scheduled++;
      m.hours += r.worked_minutes / 60;
      m.overtime += r.overtime_minutes / 60;
    }
    const series = [...byMonth.entries()].map(([k, m]) => ({
      month: k,
      pontualidade: m.onTime + m.late ? Math.round((m.onTime / (m.onTime + m.late)) * 1000) / 10 : 0,
      presenca: m.scheduled ? Math.round(((m.scheduled - m.absent) / m.scheduled) * 1000) / 10 : 0,
    }));
    return { series, last: byMonth.get(thisMonth)! };
  }, [companyId, today]);

  const runs = useData(async () => {
    if (!can("payroll.view")) return [] as RunRow[];
    return must(
      await sb()
        .from("payroll_runs")
        .select("id,version,status,totals,payroll_periods(year,month)")
        .eq("company_id", companyId)
        .neq("status", "superseded")
        .order("prepared_at", { ascending: false })
        .limit(12),
    ) as unknown as RunRow[];
  }, [companyId]);

  const series = stats.data?.series ?? [];
  const cur = series[series.length - 1];
  const last = stats.data?.last;

  return (
    <>
      <PageHeader title="Relatórios" description="Indicadores de assiduidade e exportações para Excel." />
      <PageBody>
        {stats.error ? <ErrorBlock message={stats.error} /> : null}
        {stats.loading && !stats.data ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : (
          <StatRow>
            <Stat label="Pontualidade (mês)" value={`${(cur?.pontualidade ?? 0).toLocaleString("pt-PT")}%`} />
            <Stat label="Taxa de presença" value={`${(cur?.presenca ?? 0).toLocaleString("pt-PT")}%`} />
            <Stat label="Horas trabalhadas" value={Math.round(last?.hours ?? 0).toLocaleString("pt-PT")} hint="Mês corrente" />
            <Stat label="Horas extra" value={Math.round(last?.overtime ?? 0).toLocaleString("pt-PT")} hint="Sujeitas a validação" />
          </StatRow>
        )}

        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold tracking-[-0.01em]">Evolução mensal</h2>
              <p className="mt-0.5 text-[13px] text-muted">Últimos 6 meses</p>
            </div>
            <Legend items={[{ label: "Pontualidade", color: CHART_COLORS.primary }, { label: "Presença", color: CHART_COLORS.indigo }]} />
          </div>
          {stats.data ? (
            <SmoothArea
              data={series}
              category="month"
              percent
              categoryFormat="month"
              series={[{ key: "pontualidade", name: "Pontualidade %" }, { key: "presenca", name: "Presença %" }]}
            />
          ) : (
            <Skeleton className="h-60 w-full rounded-lg" />
          )}
        </Card>

        <EmployeeReports />

        {exp ? (
          <Card>
            <div className="px-5 pt-5 sm:px-6 sm:pt-6">
              <h2 className="text-[18px] font-bold tracking-[-0.01em]">Exportações</h2>
              <p className="mt-0.5 text-[13px] text-muted">Ficheiros Excel prontos para a contabilidade.</p>
            </div>
            <div className="mt-3 divide-y divide-border">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex gap-3">
                <span className="stem mt-1.5 text-primary" aria-hidden />
                <div>
                  <p className="text-[15px] font-bold">Assiduidade mensal</p>
                  <p className="text-[13px] text-muted">Resumo por colaborador e detalhe diário.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <MonthPicker value={month} onChange={setMonth} max={thisMonth} />
                <ActionButton
                  variant="outline"
                  action={() =>
                    attempt(async () => {
                      const n = await exportAttendance(companyId, company.companyName, month, tz);
                      return n ? undefined : "Sem registos neste mês; o ficheiro foi gerado vazio.";
                    })
                  }
                >
                  Descarregar
                </ActionButton>
              </div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex gap-3">
                <span className="stem mt-1.5 text-indigo" aria-hidden />
                <div>
                  <p className="text-[15px] font-bold">Colaboradores</p>
                  <p className="text-[13px] text-muted">
                    {can("employees.salary.view") ? "Ficha resumida, com o salário base vigente." : "Ficha resumida, sem dados salariais."}
                  </p>
                </div>
              </div>
              <ActionButton
                variant="outline"
                className="self-start sm:self-auto"
                action={() =>
                  attempt(async () => {
                    await exportEmployees(companyId, company.companyName, can("employees.salary.view"), today);
                  })
                }
              >
                Descarregar
              </ActionButton>
            </div>
            </div>
          </Card>
        ) : null}

        {runs.data?.length ? (
          <Card>
            <div className="border-b border-border px-5 py-4 sm:px-6">
              <h2 className="text-[18px] font-bold tracking-[-0.01em]">Mapas salariais</h2>
            </div>
            <ul className="divide-y divide-border">
              {runs.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13.5px] sm:px-6">
                  <span className="flex items-center gap-3 font-bold">
                    {r.payroll_periods ? `${MONTHS_PT[r.payroll_periods.month - 1]} ${r.payroll_periods.year}` : "—"}
                    <span className="text-[12px] text-muted">v{r.version}</span>
                    <Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="font-bold tabular">{formatMoney(r.totals?.net, company.currency)}</span>
                    <ActionButton
                      size="sm"
                      variant="soft"
                      action={() =>
                        attempt(async () => {
                          await exportPayrollRun(r.id, company.companyName);
                        })
                      }
                    >
                      Excel
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}

type EmpRow = { id: string; full_name: string; employee_code: string; job_title: string | null; departments: { name: string } | null };
type EmpDaily = { employee_id: string; status: string; first_in: string | null; worked_minutes: number; overtime_minutes: number; late_minutes: number };
type EmpSummary = {
  id: string;
  name: string;
  code: string;
  department: string | null;
  days: number;
  worked: number;
  overtime: number;
  late: number;
  lateMinutes: number;
  justified: number;
  unjustified: number;
};

const PAGE = 25;

/** Resumo do mês por colaborador activo, com ligação ao relatório individual. */
function EmployeeReports() {
  const { companyId, tz } = useCompany();
  const thisMonth = todayIn(tz).slice(0, 7);
  const [month, setMonth] = React.useState(thisMonth);
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);

  const data = useData(async () => {
    const { from, to } = monthBounds(month);
    const [emps, daily] = await Promise.all([
      fetchAll(() =>
        sb()
          .from("employees")
          .select("id,full_name,employee_code,job_title,departments(name)")
          .eq("company_id", companyId)
          .eq("status", "active")
          .order("full_name")
          .order("id"),
      ),
      fetchAll(() =>
        sb()
          .from("attendance_daily")
          .select("employee_id,status,first_in,worked_minutes,overtime_minutes,late_minutes")
          .eq("company_id", companyId)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date")
          .order("id"),
      ),
    ]);
    const map = new Map<string, EmpSummary>();
    for (const e of emps as unknown as EmpRow[]) {
      map.set(e.id, {
        id: e.id,
        name: e.full_name,
        code: e.employee_code,
        department: e.departments?.name ?? null,
        days: 0,
        worked: 0,
        overtime: 0,
        late: 0,
        lateMinutes: 0,
        justified: 0,
        unjustified: 0,
      });
    }
    for (const d of daily as EmpDaily[]) {
      const s = map.get(d.employee_id);
      if (!s) continue;
      if (d.first_in) s.days++;
      s.worked += d.worked_minutes;
      s.overtime += d.overtime_minutes;
      if (d.status === "late") {
        s.late++;
        s.lateMinutes += d.late_minutes;
      }
      if (d.status === "justified") s.justified++;
      if (d.status === "unjustified") s.unjustified++;
    }
    return [...map.values()];
  }, [companyId, month]);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = data.data ?? [];
    return term ? list.filter((r) => `${r.name} ${r.code}`.toLowerCase().includes(term)) : list;
  }, [data.data, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">Relatório por colaborador</h2>
          <p className="mt-0.5 text-[13px] text-muted">Escolha um colaborador para ver o relatório do mês, dia a dia.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <MonthPicker
            value={month}
            onChange={(m) => {
              setMonth(m);
              setPage(1);
            }}
            max={thisMonth}
          />
          <div className="sm:w-60">
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Pesquisar nome ou número"
              aria-label="Pesquisar colaborador"
            />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {data.error ? (
          <ErrorBlock message={data.error} />
        ) : data.loading && !data.data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : filtered.length === 0 ? (
          <EmptyState title={data.data?.length ? "Nenhum colaborador corresponde à pesquisa" : "Sem colaboradores activos"} />
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link href={employeeReportHref(r.id, month)} className="block px-4 py-3 hover:bg-surface">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-[14px] font-bold">{r.name}</p>
                      <span className="shrink-0 text-[13px] font-bold tabular">{formatMinutes(r.worked)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted">
                      Nº {r.code}
                      {r.department ? `, ${r.department}` : ""}
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted tabular">
                      {r.days} dias, {formatMinutes(r.overtime)} extra, {r.late} atrasos ({r.lateMinutes} min), faltas: {r.justified} just., {r.unjustified} injust.
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Colaborador</TH>
                    <TH className="text-right">Dias</TH>
                    <TH className="text-right">Horas</TH>
                    <TH className="text-right">Extra</TH>
                    <TH className="text-right">Atrasos</TH>
                    <TH className="text-right">Faltas just.</TH>
                    <TH className="text-right">Faltas injust.</TH>
                  </tr>
                </THead>
                <tbody>
                  {shown.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={employeeReportHref(r.id, month)} className="block min-w-0 hover:underline">
                          <span className="block truncate text-[14px] font-bold text-foreground">{r.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            Nº {r.code}
                            {r.department ? `, ${r.department}` : ""}
                          </span>
                        </Link>
                      </TD>
                      <TD className="text-right tabular">{r.days}</TD>
                      <TD className="text-right font-bold tabular">{formatMinutes(r.worked)}</TD>
                      <TD className="text-right tabular">{r.overtime ? formatMinutes(r.overtime) : <span className="text-subtle">—</span>}</TD>
                      <TD className="text-right tabular">
                        {r.late ? (
                          <span>
                            {r.late} <span className="text-[12px] text-warning">({r.lateMinutes} min)</span>
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </TD>
                      <TD className="text-right tabular">{r.justified || <span className="text-subtle">—</span>}</TD>
                      <TD className={r.unjustified ? "text-right font-bold text-danger tabular" : "text-right tabular"}>
                        {r.unjustified || <span className="font-normal text-subtle">—</span>}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={current} pages={pages} onChange={setPage} />
          </>
        )}
      </div>
    </Card>
  );
}
