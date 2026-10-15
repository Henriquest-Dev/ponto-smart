import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { periodLabel } from "@/lib/format";

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Selector de mês com setas (navegação por URL). */
export function MonthPicker({ value, hrefFor, max }: { value: string; hrefFor: (ym: string) => string; max?: string }) {
  const [y, m] = value.split("-").map(Number);
  const next = shiftMonth(value, 1);
  const disabledNext = max ? next > max : false;
  const cls = "inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground";
  return (
    <div className="inline-flex h-10 items-center gap-1 rounded-md border border-border-strong bg-background px-1">
      <Link href={hrefFor(shiftMonth(value, -1))} className={cls} aria-label="Mês anterior" scroll={false}>
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-32 text-center text-[13px] font-medium">{periodLabel(y, m)}</span>
      <Link
        href={hrefFor(next)}
        aria-disabled={disabledNext}
        className={`${cls} ${disabledNext ? "pointer-events-none opacity-30" : ""}`}
        aria-label="Mês seguinte"
        scroll={false}
      >
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
