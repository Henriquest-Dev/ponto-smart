import * as React from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";


export function Avatar({ name, className, size = 36 }: { name: string; className?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-2 font-bold text-foreground", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Ignorado: a interface não usa ícones decorativos. */
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-10 text-center", className)}>
      <p className="text-[15px] font-bold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-info bg-info-soft/70 text-[#1d4d97]",
    warning: "border-warning bg-warning-soft text-[#6f4100]",
    danger: "border-danger bg-danger-soft text-[#8e1f27]",
    success: "border-success bg-success-soft text-[#0b5c35]",
  }[tone];
  return (
    <div role="note" className={cn("rounded-lg border-l-4 px-4 py-3 text-[13.5px] leading-relaxed", styles, className)}>
      {title ? <p className="mb-0.5 font-bold">{title}</p> : null}
      {children}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function DescriptionList({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="mt-0.5 text-[14px] font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
