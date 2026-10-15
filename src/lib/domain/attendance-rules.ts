/**
 * Regras puras de assiduidade (sem base de dados) — testadas em tests/attendance.test.ts.
 */
import { addDays, minutesBetween, zonedToUtc } from "@/lib/time";

export type EventType = "in" | "out" | "break_start" | "break_end";
export type DailyStatus =
  | "on_time" | "late" | "incomplete" | "absent_pending" | "justified"
  | "unjustified" | "review" | "holiday" | "day_off" | "present";

export type DayEvent = { type: EventType; occurredAt: Date; status: "accepted" | "review" };

export type DayPlan = {
  expectedStart: Date | null;
  expectedEnd: Date | null;
  breakMinutes: number;
  toleranceMinutes: number;
  isHoliday: boolean;
};

export type DayComputation = {
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  status: DailyStatus;
};

/** Plano do dia a partir da regra de horário (suporta turnos que atravessam a meia-noite). */
export function buildDayPlan(
  workDate: string,
  rule: { startTime: string; endTime: string; breakMinutes: number } | null,
  toleranceMinutes: number,
  timeZone: string,
  isHoliday: boolean,
): DayPlan {
  if (!rule || isHoliday) {
    return { expectedStart: null, expectedEnd: null, breakMinutes: 0, toleranceMinutes, isHoliday };
  }
  const start = zonedToUtc(workDate, rule.startTime, timeZone);
  const crossesMidnight = rule.endTime <= rule.startTime;
  const end = zonedToUtc(crossesMidnight ? addDays(workDate, 1) : workDate, rule.endTime, timeZone);
  return { expectedStart: start, expectedEnd: end, breakMinutes: rule.breakMinutes, toleranceMinutes, isHoliday };
}

/** Próximo tipo de marcação a partir da última marcação válida do turno aberto. */
export function nextEventType(last: EventType | null, requested?: "break_start" | "break_end" | null): EventType {
  if (last === null || last === "out") return "in";
  if (last === "break_start") return "break_end";
  // last = in | break_end → em trabalho
  return requested === "break_start" ? "break_start" : "out";
}

export function computeDay(
  events: DayEvent[],
  plan: DayPlan,
  opts: { dayIsOver: boolean; keepStatus?: "justified" | "unjustified" | null },
): DayComputation {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let worked = 0;
  let breaks = 0;
  let openIn: Date | null = null;
  let openBreak: Date | null = null;
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  let lastType: EventType | null = null;

  for (const e of sorted) {
    if (e.type === "in") {
      openIn = e.occurredAt;
      firstIn ??= e.occurredAt;
    } else if (e.type === "out" && openIn) {
      worked += minutesBetween(openIn, e.occurredAt);
      openIn = null;
      lastOut = e.occurredAt;
    } else if (e.type === "break_start") {
      openBreak = e.occurredAt;
    } else if (e.type === "break_end" && openBreak) {
      breaks += minutesBetween(openBreak, e.occurredAt);
      openBreak = null;
    }
    lastType = e.type;
  }
  worked = Math.max(0, worked - breaks);

  const late =
    firstIn && plan.expectedStart ? Math.max(0, minutesBetween(plan.expectedStart, firstIn)) : 0;
  const lateBeyondTolerance = late > plan.toleranceMinutes;

  let overtime = 0;
  if (plan.expectedStart && plan.expectedEnd && lastOut) {
    const expected = minutesBetween(plan.expectedStart, plan.expectedEnd) - plan.breakMinutes;
    const extra = worked - expected;
    overtime = extra > plan.toleranceMinutes ? extra : 0;
  }

  const base = { firstIn, lastOut, workedMinutes: worked, breakMinutes: breaks, lateMinutes: lateBeyondTolerance ? late : 0, overtimeMinutes: overtime };

  if (sorted.length === 0) {
    if (opts.keepStatus) return { ...base, status: opts.keepStatus };
    if (plan.isHoliday) return { ...base, status: "holiday" };
    if (!plan.expectedStart) return { ...base, status: "day_off" };
    return { ...base, status: "absent_pending" };
  }
  if (sorted.some((e) => e.status === "review")) return { ...base, status: "review" };
  const open = lastType === "in" || lastType === "break_start" || lastType === "break_end";
  if (open && opts.dayIsOver) return { ...base, status: "incomplete" };
  if (!plan.expectedStart) return { ...base, status: "present" };
  return { ...base, status: lateBeyondTolerance ? "late" : "on_time" };
}

export const DAILY_STATUS_LABEL: Record<DailyStatus, string> = {
  on_time: "Pontual",
  late: "Atrasado",
  incomplete: "Registo incompleto",
  absent_pending: "Falta pendente",
  justified: "Justificada",
  unjustified: "Injustificada",
  review: "Em revisão",
  holiday: "Feriado",
  day_off: "Folga",
  present: "Presente",
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  in: "Entrada",
  out: "Saída",
  break_start: "Início de intervalo",
  break_end: "Fim de intervalo",
};
