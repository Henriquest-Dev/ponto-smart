"use client";

import { AlertCircle, ArrowRight, CalendarClock, FileClock } from "lucide-react";
import Link from "next/link";
import { DailyBars, GroupedBars, Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { TodayTable, type TodayRow } from "@/components/company/p1-today-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { formatTime } from "@/lib/format";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import { rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { rollingAverage } from "@/lib/series";
import { isoWeekday } from "@/lib/time";
import type { DailyStatus } from "@/lib/domain/attendance-rules";

type Dashboard = {
  today: string;
  activeEmployees: number;
  todayRows: {
    employeeId: string;
    name: string;
    code: string;
    jobTitle: string | null;
    department: string | null;
    status: DailyStatus | null;
    firstIn: string | null;
    lastOut: string | null;
    lateMinutes: number | null;
    workedMinutes: number | null;
    lastEvent: { type: string; at: string; status: string } | null;
  }[];
  series: { date: string; present: number; late: number; absent: number; expected: number }[];
  byDepartment: { name: string; on_time: number; late: number; absent: number }[];
  pendingReviews: number;
  pendingAbsences: number;
  monthLateMinutes: number;
};

type Assignment = {
  employee_id: string;
  valid_from: string;
  valid_to: string | null;
  work_schedules: { schedule_rules: { weekday: number; start_time: string; end_time: string }[] } | null;
};

/** Fecha os dias anteriores (faltas pendentes) uma vez por sessão do navegador — substitui o agendador. */
async function closePendingDaysOnce(companyId: string) {
  const key = `ps-fecho-${companyId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // sem sessionStorage: tenta à mesma
  }
  try {
    await rpc("ps_close_pending_days", { p_company: companyId, p_days: 7 });
  } catch {
    // ignorar: o painel continua a funcionar
  }
}

export default function CompanyDashboard() {
  const { company, companyId, can, tz } = useCompany();
  const canView = can("attendance.view");

  const { data, error, loading } = useData(async () => {
    if (!canView) return null;
    await closePendingDaysOnce(companyId);
    const dash = await rpc<Dashboard>("ps_company_dashboard", { p_company: companyId, p_days: 30 });
    const today = dash.today;

    // Horário de hoje por colaborador e registos por fechar (melhor esforço).
    const [assign, days] = await Promise.all([
      sb()
        .from("shift_assignments")
        .select("employee_id,valid_from,valid_to,work_schedules(schedule_rules(weekday,start_time,end_time))")
        .eq("company_id", companyId)
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`),
      sb()
        .from("attendance_daily")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["absent_pending", "incomplete"])
        .eq("locked", false),
    ]);
    const weekday = isoWeekday(today);
    const schedules = new Map<string, string>();
    for (const a of ((assign.data ?? []) as unknown as Assignment[]).sort((x, y) => x.valid_from.localeCompare(y.valid_from))) {
      const rule = a.work_schedules?.schedule_rules?.find((r) => r.weekday === weekday);
      if (rule) schedules.set(a.employee_id, `${rule.start_time.slice(0, 5)}–${rule.end_time.slice(0, 5)}`);
      else schedules.delete(a.employee_id);
    }
    return { dash, schedules, pendingDays: days.count ?? 0 };
  }, [companyId, canView]);

  const dateLabel = new Intl.DateTimeFormat("pt-PT", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const header = (
    <PageHeader
      title="Painel"
      description={`${company.companyName} · ${dateLabel}`}
      actions={
        can("reports.view", "reports.export") ? (
          <Button variant="outline" asChild>
            <Link href="/empresa/relatorios/">Relatórios</Link>
          </Button>
        ) : null
      }
    />
  );

  if (!canView) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState title="Sem acesso à assiduidade" description="O seu papel não inclui a consulta de presenças. Use o menu para aceder às áreas disponíveis." />
        </PageBody>
      </>
    );
  }

  if (error) {
    return (
      <>
        {header}
        <PageBody>
          <Notice tone="danger" title="Não foi possível carregar o painel">{error}</Notice>
        </PageBody>
      </>
    );
  }

  if (loading && !data) {
    return (
      <>
        {header}
        <PageBody>
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </PageBody>
      </>
    );
  }
  if (!data) return header;

  const { dash, schedules, pendingDays } = data;
  const series = dash.series;
  const rows: TodayRow[] = dash.todayRows.map((r) => {
    const schedule = schedules.get(r.employeeId) ?? null;
    return {
      id: r.employeeId,
      name: r.name,
      code: r.code,
      jobTitle: r.jobTitle,
      department: r.department,
      schedule,
      firstIn: r.firstIn ? formatTime(r.firstIn, tz) : null,
      lastOut: r.lastOut ? formatTime(r.lastOut, tz) : null,
      status: r.status ?? (schedule ? "none" : "off"),
      statusLabel: r.status ? DAILY_STATUS_LABEL[r.status] : schedule ? "Sem marcação" : "Sem horário hoje",
      lateMinutes: r.lateMinutes ?? 0,
    };
  });
  const totals = {
    scheduled: rows.filter((r) => r.schedule).length,
    present: rows.filter((r) => r.firstIn).length,
    late: rows.filter((r) => r.status === "late").length,
  };
  const last30 = series.reduce((a, d) => ({ present: a.present + d.present, late: a.late + d.late, absent: a.absent + d.absent }), { present: 0, late: 0, absent: 0 });
  const punctuality = last30.present ? Math.round(((last30.present - last30.late) / last30.present) * 1000) / 10 : 0;
  const trend = rollingAverage(
    series
      .filter((d) => d.present + d.absent > 0)
      .map((d) => ({
        date: d.date,
        pontualidade: d.present ? Math.round(((d.present - d.late) / d.present) * 1000) / 10 : 0,
        presenca: Math.round((d.present / (d.present + d.absent)) * 1000) / 10,
      })),
    ["pontualidade", "presenca"],
  );
  const byDept = dash.byDepartment.map((d) => ({ department: d.name, onTime: d.on_time, late: d.late }));
  const pending = { absences: dash.pendingAbsences, reviews: dash.pendingReviews, days: pendingDays };
  const pendingTotal = pending.absences + pending.reviews + pending.days;

  return (
    <>
      {header}
      <PageBody>
        <StatRow>
          <Stat label="Presentes hoje" value={totals.present} hint={`de ${totals.scheduled} com horário hoje`} />
          <Stat label="Atrasados" value={totals.late} hint="Após a tolerância" />
          <Stat label="Pontualidade" value={`${punctuality.toLocaleString("pt-PT")}%`} hint="Últimos 30 dias" />
          <Stat label="Pendências" value={pendingTotal} hint={`${pending.absences} justificações · ${pending.reviews} revisões`} />
        </StatRow>

        {pendingTotal > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { n: pending.absences, label: "Justificações por decidir", href: "/empresa/justificacoes/", icon: FileClock, show: can("absence.decide", "absence.decide.team") },
              { n: pending.reviews, label: "Marcações em revisão", href: "/empresa/assiduidade/revisao/", icon: AlertCircle, show: true },
              { n: pending.days, label: "Faltas e registos incompletos", href: "/empresa/assiduidade/?estado=pendentes", icon: CalendarClock, show: true },
            ]
              .filter((p) => p.show && p.n > 0)
              .map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3.5 hover:border-primary/30 hover:bg-primary-soft/30"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-warning-soft text-warning">
                    <p.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[18px] leading-tight font-semibold tabular">{p.n}</span>
                    <span className="block truncate text-xs text-muted">{p.label}</span>
                  </span>
                  <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">Presenças por dia</h2>
                <p className="text-xs text-muted">Últimos 30 dias · {last30.absent} faltas registadas</p>
              </div>
              <Legend items={[{ label: "Presentes", color: CHART_COLORS.primary }]} />
            </div>
            <DailyBars data={series} dataKey="present" name="Presentes" />
          </Card>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">Pontualidade por departamento</h2>
                <p className="text-xs text-muted">Dias pontuais e com atraso · 30 dias</p>
              </div>
              <Legend items={[{ label: "Pontual", color: CHART_COLORS.indigo }, { label: "Atraso", color: CHART_COLORS.indigoSoft }]} />
            </div>
            {byDept.length ? (
              <GroupedBars
                data={byDept}
                category="department"
                series={[
                  { key: "onTime", name: "Pontual", tone: "strong" },
                  { key: "late", name: "Atraso", tone: "soft" },
                ]}
              />
            ) : (
              <EmptyState title="Ainda sem registos" description="Os dados aparecem após as primeiras marcações." className="h-56 py-6" />
            )}
          </Card>
        </div>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold">Pontualidade e presença</h2>
              <p className="text-xs text-muted">Média móvel de 7 dias · últimos 30 dias</p>
            </div>
            <Legend items={[{ label: "Pontualidade", color: CHART_COLORS.primary }, { label: "Presença", color: CHART_COLORS.indigo }]} />
          </div>
          <SmoothArea
            data={trend}
            category="date"
            categoryFormat="date"
            percent
            series={[
              { key: "pontualidade", name: "Pontualidade %" },
              { key: "presenca", name: "Presença %" },
            ]}
          />
        </Card>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold tracking-tight">Hoje</h2>
            <span className="text-xs text-muted">{dash.activeEmployees} colaboradores activos</span>
          </div>
          <TodayTable rows={rows} linkable={can("employees.view")} />
        </section>
      </PageBody>
    </>
  );
}
