"use client";

import { periodLabel } from "@/lib/format";

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mês corrente (YYYY-MM) no fuso indicado. */
export function currentMonth(timeZone = "Africa/Maputo") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

/** Selector de mês com setas. */
export function MonthPicker({ value, onChange, max }: { value: string; onChange: (ym: string) => void; max?: string }) {
  const [y, m] = value.split("-").map(Number);
  const next = shiftMonth(value, 1);
  const disabledNext = max ? next > max : false;
  const cls = "inline-flex size-9 cursor-pointer items-center justify-center rounded-full font-bold text-foreground hover:bg-background disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="inline-flex h-11 items-center gap-1 rounded-full bg-surface-2 px-1">
      <button type="button" onClick={() => onChange(shiftMonth(value, -1))} className={cls} aria-label="Mês anterior">
        <span aria-hidden className="text-[18px] leading-none">‹</span>
      </button>
      <span className="min-w-32 text-center text-[13.5px] font-bold">{periodLabel(y, m)}</span>
      <button type="button" onClick={() => onChange(next)} disabled={disabledNext} className={cls} aria-label="Mês seguinte">
        <span aria-hidden className="text-[18px] leading-none">›</span>
      </button>
    </div>
  );
}
