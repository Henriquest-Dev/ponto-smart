/**
 * Utilitários de data/hora com fuso horário explícito (por defeito Africa/Maputo).
 * As datas de trabalho são strings ISO "YYYY-MM-DD" no fuso da empresa.
 */
export const DEFAULT_TZ = "Africa/Maputo";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTz(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") map[p.type] = Number(p.value);
  return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute, second: map.second };
}

const pad = (n: number, l = 2) => String(n).padStart(l, "0");

/** Data local (YYYY-MM-DD) de um instante no fuso indicado. */
export function localDate(date: Date, timeZone = DEFAULT_TZ): string {
  const p = partsInTz(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hora local HH:MM. */
export function localTime(date: Date, timeZone = DEFAULT_TZ): string {
  const p = partsInTz(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Desvio (minutos) do fuso em relação a UTC num dado instante. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Converte data local + hora local ("HH:MM[:SS]") no fuso para instante UTC. */
export function zonedToUtc(dateIso: string, time: string, timeZone = DEFAULT_TZ): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const off = offsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - off * 60000);
  // Segunda passagem para transições de horário de verão (não aplicável a Maputo).
  const off2 = offsetMinutes(result, timeZone);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

/** Dia ISO da semana (1 = segunda … 7 = domingo) de uma data "YYYY-MM-DD". */
export function isoWeekday(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthRange(year: number, month: number): { from: string; to: string; days: number } {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(days)}`, days };
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
