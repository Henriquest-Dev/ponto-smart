"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import * as React from "react";
import { Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { exportAttendance, exportEmployees, exportPayrollRun } from "@/components/company/p2-reports";
import { ErrorBlock, fetchAll, NoAccess, todayIn } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MonthPicker, shiftMonth } from "@/components/ui/month-picker";
import { Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { formatMoney, MONTHS_PT } from "@/lib/format";
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
          <Skeleton className="h-28 w-full" />
        ) : (
          <StatRow>
            <Stat label="Pontualidade (mês)" value={`${(cur?.pontualidade ?? 0).toLocaleString("pt-PT")}%`} />
            <Stat label="Taxa de presença" value={`${(cur?.presenca ?? 0).toLocaleString("pt-PT")}%`} />
            <Stat label="Horas trabalhadas" value={Math.round(last?.hours ?? 0).toLocaleString("pt-PT")} hint="Mês corrente" />
            <Stat label="Horas extra" value={Math.round(last?.overtime ?? 0).toLocaleString("pt-PT")} hint="Sujeitas a validação" />
          </StatRow>
        )}

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Evolução mensal</h2>
              <p className="text-xs text-muted">Últimos 6 meses</p>
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
            <Skeleton className="h-60 w-full" />
          )}
        </Card>

        {exp ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <FileSpreadsheet className="size-6 text-primary" />
              <p className="mt-3 text-[15px] font-semibold">Assiduidade mensal</p>
              <p className="text-[13px] text-muted">Resumo por colaborador e detalhe diário.</p>
              <div className="mt-4 flex flex-wrap gap-2">
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
                  <Download /> Excel
                </ActionButton>
              </div>
            </Card>
            <Card className="p-5">
              <FileSpreadsheet className="size-6 text-primary" />
              <p className="mt-3 text-[15px] font-semibold">Colaboradores</p>
              <p className="text-[13px] text-muted">
                {can("employees.salary.view") ? "Ficha resumida, com o salário base vigente." : "Ficha resumida, sem dados salariais."}
              </p>
              <ActionButton
                variant="outline"
                className="mt-4"
                action={() =>
                  attempt(async () => {
                    await exportEmployees(companyId, company.companyName, can("employees.salary.view"), today);
                  })
                }
              >
                <Download /> Excel
              </ActionButton>
            </Card>
          </div>
        ) : null}

        {runs.data?.length ? (
          <Card>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-[15px] font-semibold">Mapas salariais</h2>
            </div>
            <ul className="divide-y divide-border">
              {runs.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <span className="flex items-center gap-2 font-medium">
                    {r.payroll_periods ? `${MONTHS_PT[r.payroll_periods.month - 1]} ${r.payroll_periods.year}` : "—"}
                    <span className="text-muted">· v{r.version}</span>
                    <Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="tabular">{formatMoney(r.totals?.net, company.currency)}</span>
                    <ActionButton
                      size="sm"
                      variant="ghost"
                      className="text-primary"
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
