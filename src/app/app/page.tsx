"use client";

import { ArrowRight, CalendarClock, Coffee, FileWarning, LogIn, LogOut, Receipt } from "lucide-react";
import Link from "next/link";
import { LiveDuration } from "@/components/attendance/live-duration";
import { DAILY_COLS, clockState, loadMonthDays, loadMyPayslips, loadPendingDays, summarize, useTitle, type DailyRow, type EventStatus, type MyStatus } from "@/components/collab/shared";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice, Skeleton } from "@/components/ui/misc";
import { Stat, StatRow } from "@/components/ui/stat";
import type { EventType } from "@/lib/domain/attendance-rules";
import { formatMinutes, formatMoney, formatTime, periodLabel } from "@/lib/format";
import { EVENT_STATUS, EVENT_TYPE_LABEL, dailyStatus } from "@/lib/labels";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { isoWeekday, localDate } from "@/lib/time";

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 19 ? "Boa tarde" : "Boa noite";
}

type DayEvent = { id: string; type: EventType; occurred_at: string; status: EventStatus };

/** Horário previsto de hoje: do resumo diário, ou da escala atribuída. */
async function todaySchedule(employeeId: string, today: string, daily: DailyRow | null, tz: string) {
  if (daily?.expected_start && daily.expected_end) {
    return { start: formatTime(daily.expected_start, tz), end: formatTime(daily.expected_end, tz) };
  }
  const { data } = await sb()
    .from("shift_assignments")
    .select("valid_from,valid_to,work_schedules(schedule_rules(weekday,start_time,end_time))")
    .eq("employee_id", employeeId)
    .lte("valid_from", today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("valid_from", { ascending: false })
    .limit(1);
  const ws = data?.[0]?.work_schedules as unknown as
    | { schedule_rules: { weekday: number; start_time: string; end_time: string }[] }
    | { schedule_rules: { weekday: number; start_time: string; end_time: string }[] }[]
    | null
    | undefined;
  const sched = Array.isArray(ws) ? ws[0] : ws;
  const rule = sched?.schedule_rules?.find((r) => r.weekday === isoWeekday(today));
  return rule ? { start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) } : null;
}

export default function EmployeeHome() {
  useTitle("Início");
  const { company, companyId, me, tz } = useCompany();
  const employeeId = company.employeeId!;

  const overview = useData(async () => {
    const status = await rpc<MyStatus>("ps_my_status", { p_company: companyId });
    const state = clockState(status);
    const today = localDate(new Date(), tz);
    const workDate = state !== "off" && status.workDate ? status.workDate : today;
    const [events, dailyRows, firstName] = await Promise.all([
      sb()
        .from("attendance_events")
        .select("id,type,occurred_at,status")
        .eq("employee_id", employeeId)
        .eq("work_date", workDate)
        .order("occurred_at", { ascending: true })
        .then(must),
      sb().from("attendance_daily").select(DAILY_COLS).eq("employee_id", employeeId).eq("work_date", workDate).limit(1).then(must),
      sb().from("employees").select("full_name").eq("id", employeeId).maybeSingle().then((r) => (r.data?.full_name as string | undefined) ?? me.name),
    ]);
    const daily = ((dailyRows as DailyRow[] | null) ?? [])[0] ?? null;
    const schedule = await todaySchedule(employeeId, today, daily, tz).catch(() => null);
    return { state, today, events: (events ?? []) as DayEvent[], daily, schedule, firstName: firstName.split(" ")[0] };
  }, [companyId, employeeId, tz]);

  const side = useData(async () => {
    const [slips, pendingDays] = await Promise.all([loadMyPayslips(companyId, employeeId), loadPendingDays(companyId, employeeId)]);
    return { latest: slips[0] ?? null, pendingDays };
  }, [companyId, employeeId]);

  const month = useData(async () => {
    const ym = localDate(new Date(), tz).slice(0, 7);
    return summarize(await loadMonthDays(companyId, employeeId, ym));
  }, [companyId, employeeId, tz]);

  const dateLabel = new Intl.DateTimeFormat("pt-PT", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const o = overview.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <p className="text-[13px] text-muted first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight lg:text-[26px]">
          {greeting(tz)}
          {o ? `, ${o.firstName}` : ""}
        </h1>
      </div>

      {overview.error ? <Notice tone="danger">{overview.error}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {o ? <TodayCard o={o} tz={tz} /> : <Skeleton className="h-72 rounded-xl" />}

        <div className="space-y-5">
          {side.error ? <Notice tone="danger">{side.error}</Notice> : null}
          {side.data ? <SideCards latest={side.data.latest} pendingDays={side.data.pendingDays} /> : side.loading ? <Skeleton className="h-32 rounded-xl" /> : null}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Este mês</h2>
        {month.error ? <Notice tone="danger">{month.error}</Notice> : null}
        {month.data ? (
          <StatRow>
            <Stat label="Dias trabalhados" value={month.data.workedDays} hint={`${month.data.scheduledDays} dias com horário`} />
            <Stat
              label="Pontualidade"
              value={month.data.punctuality === null ? "—" : `${month.data.punctuality.toLocaleString("pt-PT")}%`}
              hint={`${month.data.late} ${month.data.late === 1 ? "atraso" : "atrasos"}`}
            />
            <Stat label="Horas trabalhadas" value={formatMinutes(month.data.workedMinutes)} hint="Excluindo intervalos" />
            <Stat label="Horas extra" value={formatMinutes(month.data.overtimeMinutes)} hint="Sujeitas a validação" />
          </StatRow>
        ) : month.loading ? (
          <Skeleton className="h-28 rounded-xl" />
        ) : null}
      </section>
    </div>
  );
}

function TodayCard({
  o,
  tz,
}: {
  o: { state: "off" | "working" | "break"; events: DayEvent[]; daily: DailyRow | null; schedule: { start: string; end: string } | null };
  tz: string;
}) {
  const validEvents = o.events.filter((e) => e.status !== "rejected");
  const openIn = [...validEvents].reverse().find((e) => e.type === "in");
  const stateInfo = {
    off: { label: "Fora de serviço", tone: "neutral" as const },
    working: { label: "Em serviço", tone: "success" as const },
    break: { label: "Em intervalo", tone: "warning" as const },
  }[o.state];

  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <StatusDot tone={stateInfo.tone}>{stateInfo.label}</StatusDot>
          {o.schedule ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <CalendarClock className="size-3.5" />
              {o.schedule.start}–{o.schedule.end}
            </span>
          ) : (
            <span className="text-xs text-muted">Sem horário hoje</span>
          )}
        </div>
        <div className="mt-5">
          <p className="text-[13px] text-muted">Tempo trabalhado</p>
          <p className="mt-1 text-[44px] leading-none font-semibold tracking-tight">
            {o.state === "working" && openIn ? (
              <LiveDuration since={openIn.occurred_at} baseMinutes={-(o.daily?.break_minutes ?? 0)} />
            ) : (
              <span className="tabular">{formatMinutes(o.daily?.worked_minutes ?? 0)}</span>
            )}
          </p>
          <p className="mt-2 text-[13px] text-muted">
            {openIn
              ? `Entrada às ${formatTime(openIn.occurred_at, tz)}`
              : o.daily?.first_in
                ? `Entrada às ${formatTime(o.daily.first_in, tz)}`
                : "Ainda sem marcações hoje"}
            {o.daily?.last_out && o.state === "off" ? ` · Saída às ${formatTime(o.daily.last_out, tz)}` : ""}
          </p>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button size="lg" asChild className="w-full">
            <Link href="/app/marcar/">
              {o.state === "off" ? <LogIn /> : <LogOut />}
              {o.state === "off" ? "Marcar entrada" : o.state === "break" ? "Terminar intervalo" : "Marcar saída"}
            </Link>
          </Button>
          {o.state === "working" ? (
            <Button size="lg" variant="outline" asChild className="w-full">
              <Link href="/app/marcar/?tipo=intervalo">
                <Coffee /> Iniciar intervalo
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {o.events.length ? (
        <ul className="divide-y divide-border border-t border-border bg-surface/40">
          {o.events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
              <span className="text-[13px]">{EVENT_TYPE_LABEL[e.type]}</span>
              <span className="flex items-center gap-3">
                {e.status !== "accepted" ? <Badge tone={EVENT_STATUS[e.status].tone}>{EVENT_STATUS[e.status].label}</Badge> : null}
                <span className="text-[13px] font-medium tabular">{formatTime(e.occurred_at, tz)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function SideCards({
  latest,
  pendingDays,
}: {
  latest: Awaited<ReturnType<typeof loadMyPayslips>>[number] | null;
  pendingDays: Awaited<ReturnType<typeof loadPendingDays>>;
}) {
  const absenceDays = pendingDays.filter((d) => d.status === "absent_pending");
  return (
    <>
      {absenceDays.length ? (
        <Notice tone="warning" title={`${absenceDays.length} ${absenceDays.length === 1 ? "falta por justificar" : "faltas por justificar"}`}>
          <span>Submeta a justificação com documento, se aplicável. </span>
          <Link href="/app/justificacoes/" className="font-semibold underline underline-offset-2">
            Justificar agora
          </Link>
        </Notice>
      ) : null}

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">Último recibo</p>
          <Link href="/app/recibos/" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
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
                  <span className="text-muted tabular">
                    {new Date(`${d.work_date}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", timeZone: "UTC" })}
                  </span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
