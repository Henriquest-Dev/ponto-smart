import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const chip: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  success: "bg-success-soft text-[#13653e]",
  warning: "bg-warning-soft text-[#7a4b00]",
  danger: "bg-danger-soft text-[#8e1f27]",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
};

const text: Record<Tone, string> = {
  neutral: "text-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
};

/** Estado: haste arredondada (como no logótipo) seguida do texto. */
export function Badge({ tone = "neutral", className, children, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-bold whitespace-nowrap", text[tone], className)} {...props}>
      <span className="stem" aria-hidden />
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-foreground", className)}>
      <span className={cn("stem", text[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** Variação (ex.: +1,7%) em texto colorido. */
export function Delta({ value, suffix = "%", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const positive = value >= 0;
  const good = invert ? !positive : positive;
  return (
    <span className={cn("text-[12px] font-bold tabular", good ? "text-success" : "text-danger")}>
      {positive ? "+" : "−"}
      {Math.abs(value).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}
