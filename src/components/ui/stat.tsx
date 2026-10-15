import * as React from "react";
import { cn } from "@/lib/utils";

/** Linha de indicadores separados por divisórias verticais (como "Sent / Open Rate / …"). */
export function StatRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-background lg:grid-cols-4",
        "[&>*]:border-border [&>*:nth-child(2n)]:border-l lg:[&>*:not(:first-child)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  delta,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: React.ReactNode;
  /** Ignorado: a interface não usa ícones. */
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-4 sm:px-5 sm:py-5", className)}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {label}
        
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[clamp(20px,2vw,28px)] leading-none font-bold tabular whitespace-nowrap">{value}</span>
        {delta}
      </div>
      {hint ? <div className="mt-2 truncate text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
