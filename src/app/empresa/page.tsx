import { AlertCircle, ArrowRight, CalendarClock, FileClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DailyBars, GroupedBars, Legend } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { can, requireCompany } from "@/lib/auth/context";
import { formatTime } from "@/lib/format";
import { attendanceSeries, pendingCounts, punctualityByDepartment, todayBoard } from "@/lib/queries/company";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import { TodayTable } from "./today-table";

export const metadata: Metadata = { title: "Painel" };

export default async function CompanyDashboard() {
  const ctx = await requireCompany();
  const tz = ctx.company.timezone;
  const [board, pending, series, byDept] = await Promise.all([
    todayBoard(ctx),
    pendingCounts(ctx),
    attendanceSeries(ctx, 30),
    punctualityByDepartment(ctx),
  ]);
  const t = board.totals;
  const last30 = series.reduce((a, d) => ({ present: a.present + d.present, late: a.late + d.late, absent: a.absent + d.absent }), { present: 0, late: 0, absent: 0 });
  const punctuality = last30.present ? Math.round(((last30.present - last30.late) / last30.present) * 1000) / 10 : 0;
  const dateLabel = new Intl.DateTimeFormat("pt-PT", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const rows = board.rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    jobTitle: r.jobTitle,
    department: r.department,
    schedule: r.schedule,
    firstIn: r.daily?.firstIn ? formatTime(r.daily.firstIn, tz) : null,
    lastOut: r.daily?.lastOut ? formatTime(r.daily.lastOut, tz) : null,
    status: r.daily?.status ?? (r.schedule ? "none" : "off"),
    statusLabel: r.daily ? DAILY_STATUS_LABEL[r.daily.status] : r.schedule ? "Sem marcação" : "Sem horário hoje",
    lateMinutes: r.daily?.lateMinutes ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Painel"
        description={`${ctx.company.name} · ${dateLabel}`}
        actions={
          can(ctx, "reports.export") ? (
            <Button variant="outline" asChild>
              <Link href="/empresa/relatorios">Relatórios</Link>
            </Button>
          ) : null
        }
      />
      <PageBody>
        <StatRow>
          <Stat label="Presentes hoje" value={t.present} hint={`de ${t.scheduled} com horário hoje`} />
          <Stat label="Atrasados" value={t.late} hint="Após a tolerância" />
          <Stat label="Pontualidade" value={`${punctuality.toLocaleString("pt-PT")}%`} hint="Últimos 30 dias" />
          <Stat label="Pendências" value={pending.absences + pending.reviews + pending.days} hint={`${pending.absences} justificações · ${pending.reviews} revisões`} />
        </StatRow>

        {pending.absences + pending.reviews + pending.days > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { n: pending.absences, label: "Justificações por decidir", href: "/empresa/justificacoes", icon: FileClock, show: can(ctx, "absence.decide", "absence.decide.team") },
              { n: pending.reviews, label: "Marcações em revisão", href: "/empresa/assiduidade/revisao", icon: AlertCircle, show: can(ctx, "attendance.view") },
              { n: pending.days, label: "Faltas e registos incompletos", href: "/empresa/assiduidade?estado=pendentes", icon: CalendarClock, show: can(ctx, "attendance.view") },
            ]
              .filter((p) => p.show && p.n > 0)
              .map((p) => (
                <Link key={p.href} href={p.href} className="group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3.5 hover:border-primary/30 hover:bg-primary-soft/30">
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
            <GroupedBars
              data={byDept}
              category="department"
              series={[
                { key: "onTime", name: "Pontual", tone: "strong" },
                { key: "late", name: "Atraso", tone: "soft" },
              ]}
            />
          </Card>
        </div>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold tracking-tight">Hoje</h2>
          </div>
          <TodayTable rows={rows} />
        </section>
      </PageBody>
    </>
  );
}
