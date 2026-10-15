"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { LiveTimer, ThickBar } from "@/components/collab/motion";
import { DAILY_COLS, clockState, loadMonthDays, loadMyPayslips, loadPendingDays, summarize, useTitle, type DailyRow, type EventStatus, type MyStatus } from "@/components/collab/shared";
import { Badge } from "@/components/ui/badge";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice, Skeleton } from "@/components/ui/misc";
import type { EventType } from "@/lib/domain/attendance-rules";
import { formatMinutes, formatMoney, formatTime, periodLabel } from "@/lib/format";
import { EVENT_STATUS, EVENT_TYPE_LABEL, dailyStatus } from "@/lib/labels";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";
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
    <div className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
      <div>
        <p className="text-[14px] font-bold text-muted first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-1 text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em] lg:text-[38px]">
          {greeting(tz)}
          {o ? <span className="text-primary">, {o.firstName}</span> : null}
        </h1>
      </div>

      {overview.error ? <Notice tone="danger">{overview.error}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {o ? <TodayCard o={o} tz={tz} /> : <Skeleton className="h-[380px] rounded-[28px]" />}

        <div className="space-y-4">
          {side.error ? <Notice tone="danger">{side.error}</Notice> : null}
          {side.data ? (
            <SideCards latest={side.data.latest} pendingDays={side.data.pendingDays} />
          ) : side.loading ? (
            <Skeleton className="h-40 rounded-[22px]" />
          ) : null}
        </div>
      </div>

      <section>
        <SectionTitle title="Este mês" />
        {month.error ? <Notice tone="danger">{month.error}</Notice> : null}
        {month.data ? <MonthBlock m={month.data} /> : month.loading ? <Skeleton className="h-40 rounded-[22px]" /> : null}
      </section>
    </div>
  );
}

/** Minutos desde a meia-noite, no fuso da empresa. */
function nowMinutes(tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function TodayCard({
  o,
  tz,
}: {
  o: { state: "off" | "working" | "break"; events: DayEvent[]; daily: DailyRow | null; schedule: { start: string; end: string } | null };
  tz: string;
}) {
  const reduce = useReducedMotion();
  const validEvents = o.events.filter((e) => e.status !== "rejected");
  const openIn = [...validEvents].reverse().find((e) => e.type === "in");
  const stateInfo = {
    off: { label: "Fora de serviço", color: "text-white/45" },
    working: { label: "Em serviço", color: "text-[#5fe0a0]" },
    break: { label: "Em intervalo", color: "text-[#ffc56b]" },
  }[o.state];

  // Progresso do turno previsto (só quando há horário e não é um turno nocturno).
  let shiftPct: number | null = null;
  if (o.schedule) {
    const a = toMinutes(o.schedule.start);
    const b = toMinutes(o.schedule.end);
    if (b > a) shiftPct = Math.max(0, Math.min(100, ((nowMinutes(tz) - a) / (b - a)) * 100));
  }

  const subline = [
    openIn ? `Entrada às ${formatTime(openIn.occurred_at, tz)}` : o.daily?.first_in ? `Entrada às ${formatTime(o.daily.first_in, tz)}` : "Ainda sem marcações hoje",
    o.daily?.last_out && o.state === "off" ? `saída às ${formatTime(o.daily.last_out, tz)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="overflow-hidden rounded-[28px] bg-foreground text-white"
    >
      <div className="p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[14px] font-bold">
            <motion.span
              className={cn("stem h-4", stateInfo.color)}
              aria-hidden
              animate={o.state === "working" && !reduce ? { scaleY: [1, 1.5, 1] } : undefined}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            {stateInfo.label}
          </span>
          <span className="text-[13px] font-bold text-white/60 tabular">
            {o.schedule ? `${o.schedule.start}–${o.schedule.end}` : "Sem horário hoje"}
          </span>
        </div>

        <p className="mt-7 text-[14px] font-bold text-white/60">Tempo trabalhado</p>
        <p className="mt-1 text-[64px] leading-none font-extrabold tracking-[-0.04em] sm:text-[76px]">
          {o.state === "working" && openIn ? (
            <LiveTimer since={openIn.occurred_at} baseMinutes={-(o.daily?.break_minutes ?? 0)} />
          ) : (
            <span className="tabular">{formatMinutes(o.daily?.worked_minutes ?? 0)}</span>
          )}
        </p>
        <p className="mt-3 text-[14px] text-white/70">{subline}</p>

        {shiftPct !== null ? (
          <div className="mt-6">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/12">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: reduce ? `${shiftPct}%` : "0%" }}
                animate={{ width: `${shiftPct}%` }}
                transition={reduce ? { duration: 0 } : { duration: 0.9, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[12px] font-bold text-white/50 tabular">
              <span>{o.schedule!.start}</span>
              <span>{Math.round(shiftPct)}% do turno</span>
              <span>{o.schedule!.end}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-7 grid gap-2 sm:grid-cols-2">
          <motion.div whileTap={reduce ? undefined : { scale: 0.98 }} className={cn(o.state !== "working" && "sm:col-span-2")}>
            <Link
              href="/app/marcar/"
              className="flex h-14 w-full items-center justify-center rounded-full bg-primary text-[16px] font-extrabold text-white transition-colors hover:bg-primary-hover"
            >
              {o.state === "off" ? "Marcar entrada" : o.state === "break" ? "Terminar intervalo" : "Marcar saída"}
            </Link>
          </motion.div>
          {o.state === "working" ? (
            <Link
              href="/app/marcar/?tipo=intervalo"
              className="flex h-14 w-full items-center justify-center rounded-full border-2 border-white/20 text-[15px] font-bold text-white transition-colors hover:border-white/50"
            >
              Iniciar intervalo
            </Link>
          ) : null}
        </div>
      </div>

      {o.events.length ? (
        <ol className="space-y-0 border-t border-white/10 px-6 py-4 sm:px-7">
          {o.events.map((e, i) => (
            <motion.li
              key={e.id}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              className="flex items-center gap-3 py-2"
            >
              <span className={cn("stem h-5", e.status === "rejected" ? "text-white/25" : e.type === "in" || e.type === "break_end" ? "text-primary" : "text-white/60")} aria-hidden />
              <span className="flex-1 text-[14px] font-bold">{EVENT_TYPE_LABEL[e.type]}</span>
              {e.status !== "accepted" ? (
                <span className={cn("text-[12.5px] font-bold", e.status === "review" ? "text-[#ffc56b]" : "text-[#ff8a92]")}>{EVENT_STATUS[e.status].label}</span>
              ) : null}
              <span className="text-[15px] font-extrabold tabular">{formatTime(e.occurred_at, tz)}</span>
            </motion.li>
          ))}
        </ol>
      ) : null}
    </motion.div>
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
        <Link href="/app/justificacoes/" className="group block rounded-[22px] bg-warning-soft p-5 transition-colors hover:bg-[#fbe8c6]">
          <p className="flex items-baseline gap-2.5 text-[#6f4100]">
            <span className="text-[34px] leading-none font-extrabold tabular">{absenceDays.length}</span>
            <span className="text-[15px] font-extrabold">{absenceDays.length === 1 ? "falta por justificar" : "faltas por justificar"}</span>
          </p>
          <p className="mt-2 text-[13.5px] text-[#6f4100]/80">Submeta a justificação com documento, se aplicável.</p>
          <span className="mt-3 inline-block text-[13.5px] font-extrabold text-[#6f4100] underline decoration-2 underline-offset-4 decoration-[#6f4100]/30 group-hover:decoration-[#6f4100]">
            Justificar agora
          </span>
        </Link>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-[16px] font-extrabold tracking-[-0.01em]">Último recibo</p>
          <Link href="/app/recibos/" className="text-[13px] font-bold text-primary hover:underline">
            Ver todos
          </Link>
        </div>
        {latest ? (
          <div className="mt-4">
            <p className="text-[13px] font-bold text-muted">{periodLabel(latest.year, latest.month)}</p>
            <p className="mt-1 text-[30px] leading-none font-extrabold tracking-[-0.02em] tabular">{formatMoney(latest.net, latest.currency)}</p>
            <div className="mt-3">{latest.acknowledgedAt ? <Badge tone="success">Recebido</Badge> : <Badge tone="warning">Por confirmar</Badge>}</div>
          </div>
        ) : (
          <p className="mt-3 text-[13.5px] text-muted">Ainda não há recibos emitidos.</p>
        )}
      </Card>

      {pendingDays.length ? (
        <div className="rounded-[22px] bg-surface p-5 sm:p-6">
          <p className="text-[16px] font-extrabold tracking-[-0.01em]">Ocorrências recentes</p>
          <ul className="mt-3 space-y-2.5">
            {pendingDays.slice(0, 4).map((d) => {
              const s = dailyStatus(d.status);
              return (
                <li key={d.id} className="flex items-center justify-between text-[13.5px]">
                  <span className="font-bold tabular">
                    {new Date(`${d.work_date}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", timeZone: "UTC" })}
                  </span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function MonthBlock({ m }: { m: ReturnType<typeof summarize> }) {
  const workedPct = m.scheduledDays ? (m.workedDays / m.scheduledDays) * 100 : 0;
  return (
    <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <Card className="p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[13px] font-bold text-muted">Horas trabalhadas</p>
            <p className="mt-1 text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular">{formatMinutes(m.workedMinutes)}</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] font-bold text-muted">Horas extra</p>
            <p className="mt-1 text-[22px] leading-none font-extrabold text-primary tabular">{formatMinutes(m.overtimeMinutes)}</p>
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">Excluindo intervalos. As horas extra estão sujeitas a validação.</p>
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between text-[13px]">
            <span className="font-bold">Dias trabalhados</span>
            <span className="text-muted tabular">
              <span className="font-extrabold text-foreground">{m.workedDays}</span> de {m.scheduledDays} com horário
            </span>
          </div>
          <ThickBar value={workedPct} />
        </div>
      </Card>

      <div className="rounded-[22px] bg-surface p-5 sm:p-6">
        <p className="text-[13px] font-bold text-muted">Pontualidade</p>
        <p className="mt-1 text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular">
          {m.punctuality === null ? "—" : `${m.punctuality.toLocaleString("pt-PT")}%`}
        </p>
        <div className="mt-5">
          <ThickBar value={m.punctuality ?? 0} tone={m.punctuality !== null && m.punctuality < 80 ? "warning" : "success"} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <span className={cn("stem", m.late ? "text-warning" : "text-success")} aria-hidden />
          {m.late} {m.late === 1 ? "atraso" : "atrasos"} este mês
        </p>
      </div>
    </div>
  );
}
