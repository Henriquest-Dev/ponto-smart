import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Download, FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import { Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceDaily, employees, payrollPeriods, payrollRuns } from "@/lib/db/schema";
import { formatMoney, MONTHS_PT } from "@/lib/format";
import { teamFilter } from "@/lib/queries/scope";
import { localDate } from "@/lib/time";

export const metadata: Metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  const ctx = await requireCompany("reports.view");
  const today = localDate(new Date(), ctx.company.timezone);
  const [ty, tm] = today.split("-").map(Number);
  const start = new Date(Date.UTC(ty, tm - 6, 1)).toISOString().slice(0, 10);
  const monthly = await db
    .select({
      month: sql<string>`to_char(${attendanceDaily.workDate}, 'YYYY-MM')`,
      onTime: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'on_time')`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'late')`.mapWith(Number),
      absent: sql<number>`count(*) filter (where ${attendanceDaily.status} in ('absent_pending','unjustified','justified'))`.mapWith(Number),
      scheduled: sql<number>`count(*) filter (where ${attendanceDaily.status} not in ('holiday','day_off'))`.mapWith(Number),
      hours: sql<number>`coalesce(sum(${attendanceDaily.workedMinutes}),0) / 60.0`.mapWith(Number),
      overtime: sql<number>`coalesce(sum(${attendanceDaily.overtimeMinutes}),0) / 60.0`.mapWith(Number),
    })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .where(and(eq(attendanceDaily.companyId, ctx.company.id), gte(attendanceDaily.workDate, start), teamFilter(ctx)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const series = monthly.map((m) => ({
    month: m.month,
    pontualidade: m.onTime + m.late ? Math.round((m.onTime / (m.onTime + m.late)) * 1000) / 10 : 0,
    presenca: m.scheduled ? Math.round(((m.scheduled - m.absent) / m.scheduled) * 1000) / 10 : 0,
  }));
  const last = monthly[monthly.length - 1];
  const runs = can(ctx, "payroll.view")
    ? await db
        .select({ year: payrollPeriods.year, month: payrollPeriods.month, totals: payrollRuns.totals, id: payrollRuns.id, version: payrollRuns.version })
        .from(payrollRuns)
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
        .where(and(eq(payrollRuns.companyId, ctx.company.id), sql`${payrollRuns.status} <> 'superseded'`))
        .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month))
        .limit(6)
    : [];
  const exp = can(ctx, "reports.export");

  return (
    <>
      <PageHeader title="Relatórios" description="Indicadores de assiduidade e exportações para Excel." />
      <PageBody>
        <StatRow>
          <Stat label="Pontualidade (mês)" value={`${(series[series.length - 1]?.pontualidade ?? 0).toLocaleString("pt-PT")}%`} />
          <Stat label="Taxa de presença" value={`${(series[series.length - 1]?.presenca ?? 0).toLocaleString("pt-PT")}%`} />
          <Stat label="Horas trabalhadas" value={Math.round(last?.hours ?? 0).toLocaleString("pt-PT")} hint="Mês corrente" />
          <Stat label="Horas extra" value={Math.round(last?.overtime ?? 0).toLocaleString("pt-PT")} hint="Sujeitas a validação" />
        </StatRow>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Evolução mensal</h2>
              <p className="text-xs text-muted">Últimos 6 meses</p>
            </div>
            <Legend items={[{ label: "Pontualidade", color: CHART_COLORS.primary }, { label: "Presença", color: CHART_COLORS.indigo }]} />
          </div>
          <SmoothArea data={series} category="month" percent categoryFormat="month" series={[{ key: "pontualidade", name: "Pontualidade %" }, { key: "presenca", name: "Presença %" }]} />
        </Card>

        {exp ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <FileSpreadsheet className="size-6 text-primary" />
              <p className="mt-3 text-[15px] font-semibold">Assiduidade mensal</p>
              <p className="text-[13px] text-muted">Resumo por colaborador e detalhe diário.</p>
              <form action="/api/reports/attendance" method="get" className="mt-4 flex gap-2">
                <Input type="month" name="month" defaultValue={today.slice(0, 7)} className="max-w-48" required />
                <Button type="submit" variant="outline"><Download /> Excel</Button>
              </form>
            </Card>
            <Card className="p-5">
              <FileSpreadsheet className="size-6 text-primary" />
              <p className="mt-3 text-[15px] font-semibold">Colaboradores</p>
              <p className="text-[13px] text-muted">Ficha resumida, sem dados salariais.</p>
              <Button asChild variant="outline" className="mt-4"><a href="/api/reports/employees"><Download /> Excel</a></Button>
            </Card>
          </div>
        ) : null}

        {runs.length ? (
          <Card>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-[15px] font-semibold">Mapas salariais</h2>
            </div>
            <ul className="divide-y divide-border">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <span className="font-medium">{MONTHS_PT[r.month - 1]} {r.year} <span className="text-muted">· v{r.version}</span></span>
                  <span className="flex items-center gap-4">
                    <span className="tabular">{formatMoney(r.totals.net, ctx.company.currency)}</span>
                    <a href={`/api/reports/payroll/${r.id}`} className="font-medium text-primary">Excel</a>
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
