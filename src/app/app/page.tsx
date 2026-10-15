import { ArrowRight, CalendarClock, Coffee, FileWarning, LogIn, LogOut, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveDuration } from "@/components/attendance/live-duration";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { Stat, StatRow } from "@/components/ui/stat";
import { requireEmployee } from "@/lib/auth/context";
import { formatMinutes, formatMoney, formatTime, periodLabel } from "@/lib/format";
import { EVENT_STATUS, EVENT_TYPE_LABEL, dailyStatus } from "@/lib/labels";
import { monthDays, myPayslips, summarize, todayOverview, unjustifiedDays } from "@/lib/queries/employee";

export const metadata: Metadata = { title: "Início" };

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 19 ? "Boa tarde" : "Boa noite";
}

export default async function EmployeeHome() {
  const ctx = await requireEmployee();
  const tz = ctx.company.timezone;
  const [overview, slips, pendingDays] = await Promise.all([
    todayOverview(ctx.company.id, ctx.employee.id, tz),
    myPayslips(ctx.company.id, ctx.employee.id),
    unjustifiedDays(ctx.company.id, ctx.employee.id),
  ]);
  const [y, m] = overview.today.split("-").map(Number);
  const summary = summarize(await monthDays(ctx.company.id, ctx.employee.id, y, m));
  const firstName = ctx.employee.fullName.split(" ")[0];
  const dateLabel = new Intl.DateTimeFormat("pt-PT", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const validEvents = overview.events.filter((e) => e.status !== "rejected");
  const openIn = [...validEvents].reverse().find((e) => e.type === "in");
  const stateInfo = {
    off: { label: "Fora de serviço", tone: "neutral" as const },
    working: { label: "Em serviço", tone: "success" as const },
    break: { label: "Em intervalo", tone: "warning" as const },
  }[overview.state];
  const absenceDays = pendingDays.filter((d) => d.status === "absent_pending");
  const latest = slips[0];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <p className="text-[13px] text-muted first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight lg:text-[26px]">
          {greeting(tz)}, {firstName}
        </h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <StatusDot tone={stateInfo.tone}>{stateInfo.label}</StatusDot>
              {overview.rule ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <CalendarClock className="size-3.5" />
                  {overview.rule.startTime.slice(0, 5)}–{overview.rule.endTime.slice(0, 5)}
                </span>
              ) : (
                <span className="text-xs text-muted">Sem horário hoje</span>
              )}
            </div>
            <div className="mt-5">
              <p className="text-[13px] text-muted">Tempo trabalhado</p>
              <p className="mt-1 text-[44px] leading-none font-semibold tracking-tight">
                {overview.state === "working" && openIn ? (
                  <LiveDuration since={openIn.occurredAt.toISOString()} baseMinutes={-(overview.daily?.breakMinutes ?? 0)} />
                ) : (
                  <span className="tabular">{formatMinutes(overview.daily?.workedMinutes ?? 0)}</span>
                )}
              </p>
              <p className="mt-2 text-[13px] text-muted">
                {openIn ? `Entrada às ${formatTime(openIn.occurredAt, tz)}` : overview.daily?.firstIn ? `Entrada às ${formatTime(overview.daily.firstIn, tz)}` : "Ainda sem marcações hoje"}
                {overview.daily?.lastOut && overview.state === "off" ? ` · Saída às ${formatTime(overview.daily.lastOut, tz)}` : ""}
              </p>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Button size="lg" asChild className="w-full">
                <Link href="/app/marcar">
                  {overview.state === "off" ? <LogIn /> : <LogOut />}
                  {overview.state === "off" ? "Marcar entrada" : overview.state === "break" ? "Terminar intervalo" : "Marcar saída"}
                </Link>
              </Button>
              {overview.state === "working" ? (
                <Button size="lg" variant="outline" asChild className="w-full">
                  <Link href="/app/marcar?tipo=intervalo">
                    <Coffee /> Iniciar intervalo
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
          {overview.events.length ? (
            <ul className="divide-y divide-border border-t border-border bg-surface/40">
              {overview.events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <span className="text-[13px]">{EVENT_TYPE_LABEL[e.type]}</span>
                  <span className="flex items-center gap-3">
                    {e.status !== "accepted" ? <Badge tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Badge> : null}
                    <span className="text-[13px] font-medium tabular">{formatTime(e.occurredAt, tz)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <div className="space-y-5">
          {absenceDays.length ? (
            <Notice tone="warning" title={`${absenceDays.length} ${absenceDays.length === 1 ? "falta por justificar" : "faltas por justificar"}`}>
              <span>Submeta a justificação com documento, se aplicável. </span>
              <Link href="/app/justificacoes" className="font-semibold underline underline-offset-2">
                Justificar agora
              </Link>
            </Notice>
          ) : null}

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold">Último recibo</p>
              <Link href="/app/recibos" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                Ver todos <ArrowRight className="size-3.5" />
              </Link>
            </div>
            {latest ? (
              <div className="mt-4 flex items-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Receipt className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-muted">{periodLabel(latest.year, latest.month)}</p>
                  <p className="text-[20px] font-semibold tracking-tight tabular">{formatMoney(latest.net, latest.currency)}</p>
                </div>
                {latest.acknowledgedAt ? <Badge tone="success">Recebido</Badge> : <Badge tone="warning">Por confirmar</Badge>}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-muted">Ainda não há recibos emitidos.</p>
            )}
          </Card>

          {pendingDays.length ? (
            <Card className="p-5">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <FileWarning className="size-4 text-warning" /> Ocorrências recentes
              </p>
              <ul className="mt-3 space-y-2.5">
                {pendingDays.slice(0, 4).map((d) => {
                  const s = dailyStatus(d.status);
                  return (
                    <li key={d.id} className="flex items-center justify-between text-[13px]">
                      <span className="text-muted tabular">{new Date(`${d.workDate}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Este mês</h2>
        <StatRow>
          <Stat label="Dias trabalhados" value={summary.workedDays} hint={`${summary.scheduledDays} dias com horário`} />
          <Stat label="Pontualidade" value={summary.punctuality === null ? "—" : `${summary.punctuality.toLocaleString("pt-PT")}%`} hint={`${summary.late} ${summary.late === 1 ? "atraso" : "atrasos"}`} />
          <Stat label="Horas trabalhadas" value={formatMinutes(summary.workedMinutes)} hint="Excluindo intervalos" />
          <Stat label="Horas extra" value={formatMinutes(summary.overtimeMinutes)} hint="Sujeitas a validação" />
        </StatRow>
      </section>
    </div>
  );
}
