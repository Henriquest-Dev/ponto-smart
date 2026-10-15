import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
};

const dots: Record<Tone, string> = {
  neutral: "bg-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  primary: "bg-primary",
};

export function Badge({ tone = "neutral", className, children, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** Estado com ponto colorido, como na tabela de referência (sem fundo). */
export function StatusDot({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] text-foreground whitespace-nowrap", className)}>
      <span className={cn("size-2 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}

/** Pequena pílula de variação (ex.: +1,7%). */
export function Delta({ value, suffix = "%", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const positive = value >= 0;
  const good = invert ? !positive : positive;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-medium tabular",
        good ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
      )}
    >
      <svg viewBox="0 0 12 12" className={cn("size-2.5", !positive && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 9 9 3M4.5 3H9v4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {Math.abs(value).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}
