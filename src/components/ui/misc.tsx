import * as React from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

const palette = ["#efe9fe:#5f32d6", "#e3f6ea:#0b7d46", "#fff3d9:#9a5d00", "#e5eefc:#2358ab", "#fdeaea:#b52a33", "#ececf3:#3c3f52"];

export function Avatar({ name, className, size = 36 }: { name: string; className?: string; size?: number }) {
  const idx = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length;
  const [bg, fg] = palette[idx].split(":");
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", className)}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }}
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
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p> : null}
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
    info: "border-info/20 bg-info-soft/60 text-[#1d4d97]",
    warning: "border-warning/25 bg-warning-soft/70 text-[#7a4a00]",
    danger: "border-danger/20 bg-danger-soft/70 text-[#9b1f28]",
    success: "border-success/20 bg-success-soft/70 text-[#0b6b3d]",
  }[tone];
  return (
    <div role="note" className={cn("rounded-lg border px-4 py-3 text-[13px] leading-relaxed", styles, className)}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
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
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
