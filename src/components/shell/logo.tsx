import { cn } from "@/lib/utils";
import { HORBIT_PATH, HORBIT_VIEWBOX } from "./logo-path";

/** Símbolo Horbit: o "H" do logótipo em traço arredondado. */
export function LogoMark({ className, color = "var(--primary)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 360 360" className={cn("size-8", className)} aria-hidden>
      <g fill="none" stroke={color} strokeWidth="72" strokeLinecap="round">
        <path d="M70 48V312" />
        <path d="M262 48V128" />
        <path d="M70 196C130 150 165 175 198 214C228 250 262 262 300 252" />
      </g>
    </svg>
  );
}

/** Logótipo completo "Horbit". */
export function Wordmark({ className, color = "var(--primary)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox={HORBIT_VIEWBOX} className={cn("h-7 w-auto", className)} role="img" aria-label="Horbit">
      <path fill={color} fillRule="evenodd" d={HORBIT_PATH} />
    </svg>
  );
}

export function Logo({ className, subtitle, dark }: { className?: string; subtitle?: string; dark?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Wordmark className="h-6" color={dark ? "#ffffff" : undefined} />
      {subtitle ? <div className={cn("max-w-[180px] truncate text-[12px] font-medium", dark ? "text-white/55" : "text-muted")}>{subtitle}</div> : null}
    </div>
  );
}
