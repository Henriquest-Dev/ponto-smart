import { describe, expect, it } from "vitest";
import { buildDayPlan, computeDay, nextEventType, type DayEvent } from "@/lib/domain/attendance-rules";
import { zonedToUtc } from "@/lib/time";

const TZ = "Africa/Maputo";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
const ev = (type: DayEvent["type"], date: string, time: string, status: DayEvent["status"] = "accepted"): DayEvent => ({ type, occurredAt: at(date, time), status });

describe("fuso horário", () => {
  it("08:00 em Maputo é 06:00 UTC", () => {
    expect(at("2026-10-15", "08:00").toISOString()).toBe("2026-10-15T06:00:00.000Z");
  });
});

describe("nextEventType", () => {
  it("alterna entrada/saída e intervalos", () => {
    expect(nextEventType(null)).toBe("in");
    expect(nextEventType("in")).toBe("out");
    expect(nextEventType("in", "break_start")).toBe("break_start");
    expect(nextEventType("break_start")).toBe("break_end");
    expect(nextEventType("break_end")).toBe("out");
    expect(nextEventType("out")).toBe("in");
  });
});

describe("computeDay", () => {
  const rule = { startTime: "08:00", endTime: "17:00", breakMinutes: 60 };
  const plan = buildDayPlan("2026-10-14", rule, 10, TZ, false);

  it("pontual dentro da tolerância", () => {
    const r = computeDay([ev("in", "2026-10-14", "08:07"), ev("out", "2026-10-14", "17:05")], plan, { dayIsOver: true });
    expect(r.status).toBe("on_time");
    expect(r.lateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(538);
  });

  it("atraso após tolerância (sem multa — apenas registo)", () => {
    const r = computeDay([ev("in", "2026-10-14", "08:25"), ev("out", "2026-10-14", "17:00")], plan, { dayIsOver: true });
    expect(r.status).toBe("late");
    expect(r.lateMinutes).toBe(25);
  });

  it("desconta intervalos registados", () => {
    const r = computeDay(
      [ev("in", "2026-10-14", "08:00"), ev("break_start", "2026-10-14", "12:00"), ev("break_end", "2026-10-14", "13:00"), ev("out", "2026-10-14", "17:00")],
      plan,
      { dayIsOver: true },
    );
    expect(r.workedMinutes).toBe(480);
    expect(r.breakMinutes).toBe(60);
  });

  it("horas extra acima da tolerância", () => {
    const r = computeDay([ev("in", "2026-10-14", "08:00"), ev("out", "2026-10-14", "19:00")], plan, { dayIsOver: true });
    // 11h - 1h de intervalo previsto não registado → 660 trabalhados vs 480 previstos
    expect(r.overtimeMinutes).toBe(180);
  });

  it("saída em falta num dia terminado → registo incompleto", () => {
    expect(computeDay([ev("in", "2026-10-14", "08:00")], plan, { dayIsOver: true }).status).toBe("incomplete");
  });

  it("sem marcações com horário → falta pendente (não injustificada automaticamente)", () => {
    expect(computeDay([], plan, { dayIsOver: true }).status).toBe("absent_pending");
  });

  it("mantém classificação justificada", () => {
    expect(computeDay([], plan, { dayIsOver: true, keepStatus: "justified" }).status).toBe("justified");
  });

  it("feriado e folga", () => {
    expect(computeDay([], buildDayPlan("2026-10-04", rule, 10, TZ, true), { dayIsOver: true }).status).toBe("holiday");
    expect(computeDay([], buildDayPlan("2026-10-18", null, 10, TZ, false), { dayIsOver: true }).status).toBe("day_off");
  });

  it("marcação em revisão marca o dia em revisão", () => {
    expect(computeDay([ev("in", "2026-10-14", "08:00", "review"), ev("out", "2026-10-14", "17:00")], plan, { dayIsOver: true }).status).toBe("review");
  });

  it("turno nocturno que atravessa a meia-noite", () => {
    const night = buildDayPlan("2026-10-14", { startTime: "22:00", endTime: "06:00", breakMinutes: 30 }, 15, TZ, false);
    expect(night.expectedEnd!.getTime() - night.expectedStart!.getTime()).toBe(8 * 3600_000);
    const r = computeDay([ev("in", "2026-10-14", "21:55"), ev("out", "2026-10-15", "06:02")], night, { dayIsOver: true });
    expect(r.status).toBe("on_time");
    expect(r.workedMinutes).toBe(487);
  });
});
