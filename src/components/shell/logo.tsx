import { cn } from "@/lib/utils";

/** Marca PontoSmart: um "P" geométrico com o ponteiro de um relógio. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M11 24V8h6.2a5.6 5.6 0 0 1 0 11.2H11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 11.2v2.6l1.8 1.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
    </svg>
  );
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">PontoSmart</div>
        {subtitle ? <div className="max-w-[150px] truncate text-[11px] text-muted">{subtitle}</div> : null}
      </div>
    </div>
  );
}
