import Link from "next/link";
import { cn } from "@/lib/utils";

/** Separadores em forma de pílula (ex.: "Sent Emails / Campaigns"), baseados em links. */
export function LinkTabs({ items, active, className }: { items: { href: string; label: string; key: string; count?: number }[]; active: string; className?: string }) {
  return (
    <div className={cn("inline-flex max-w-full gap-5 overflow-x-auto border-b border-border scrollbar-none", className)}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "relative inline-flex h-10 shrink-0 items-center gap-1.5 text-[14px] font-bold transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-[4px] after:rounded-full after:bg-primary after:transition-transform after:duration-200",
            active === t.key ? "text-foreground after:scale-x-100" : "text-muted after:scale-x-0 hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn("text-[12px] tabular", active === t.key ? "text-primary" : "text-subtle")}>{t.count}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

/** Separadores com estado local (sem mudar de URL). */
export function Tabs<K extends string>({ items, active, onChange, className }: { items: { key: K; label: string; count?: number }[]; active: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex max-w-full gap-5 overflow-x-auto border-b border-border scrollbar-none", className)}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 text-[14px] font-bold transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-[4px] after:rounded-full after:bg-primary after:transition-transform after:duration-200",
            active === t.key ? "text-foreground after:scale-x-100" : "text-muted after:scale-x-0 hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn("text-[12px] tabular", active === t.key ? "text-primary" : "text-subtle")}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
