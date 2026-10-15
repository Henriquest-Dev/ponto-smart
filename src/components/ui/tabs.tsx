import Link from "next/link";
import { cn } from "@/lib/utils";

/** Separadores em forma de pílula (ex.: "Sent Emails / Campaigns"), baseados em links. */
export function LinkTabs({ items, active, className }: { items: { href: string; label: string; key: string; count?: number }[]; active: string; className?: string }) {
  return (
    <div className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface p-1 scrollbar-none", className)}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
            active === t.key ? "bg-background text-primary shadow-[0_1px_2px_rgb(17_19_31/0.06)]" : "text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn("rounded-full px-1.5 text-[11px] tabular", active === t.key ? "bg-primary-soft" : "bg-surface-2")}>{t.count}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

/** Separadores com estado local (sem mudar de URL). */
export function Tabs<K extends string>({ items, active, onChange, className }: { items: { key: K; label: string; count?: number }[]; active: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface p-1 scrollbar-none", className)}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
            active === t.key ? "bg-background text-primary shadow-[0_1px_2px_rgb(17_19_31/0.06)]" : "text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn("rounded-full px-1.5 text-[11px] tabular", active === t.key ? "bg-primary-soft" : "bg-surface-2")}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
