"use client";

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./icons";
import { Logo } from "./logo";
import type { NavItem, NavSection } from "./nav-types";

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function isActive(rawPath: string, rawHref: string, rawRoot: string) {
  const pathname = trim(rawPath);
  const href = trim(rawHref.split("?")[0]);
  const root = trim(rawRoot);
  if (href === root) return pathname === root;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Item({ item, pathname, root, onNavigate }: { item: NavItem; pathname: string; root: string; onNavigate?: () => void }) {
  const Icon = NAV_ICONS[item.icon];
  const active = isActive(pathname, item.href, root);
  const [open, setOpen] = React.useState(active);
  React.useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  if (item.children?.length) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-md px-3 text-[14px] text-[#3a3d4f] transition-colors hover:bg-background/70",
            active && "font-medium text-foreground",
          )}
        >
          <Icon className="size-[18px] text-[#4a4d5f]" strokeWidth={1.7} />
          <span className="flex-1 text-left">{item.label}</span>
          {item.badge ? <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-medium text-primary tabular">{item.badge}</span> : null}
          <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <ul className="mt-1 mb-1 space-y-0.5 pl-9">
            {item.children.map((c) => {
              const childActive = pathname === c.href || (c.href !== item.href && pathname.startsWith(`${c.href}/`));
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex h-9 items-center rounded-md px-3 text-[13.5px] text-muted transition-colors hover:text-foreground",
                      childActive && "bg-background font-medium text-primary shadow-[0_1px_2px_rgb(17_19_31/0.05)]",
                    )}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-md px-3 text-[14px] text-[#3a3d4f] transition-colors hover:bg-background/70",
          active && "bg-background font-medium text-primary shadow-[0_1px_2px_rgb(17_19_31/0.05)] [&_svg]:text-primary",
        )}
      >
        <Icon className="size-[18px] text-[#4a4d5f]" strokeWidth={1.7} />
        <span className="flex-1">{item.label}</span>
        {item.badge ? <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-medium text-primary tabular">{item.badge}</span> : null}
      </Link>
    </li>
  );
}

export function SidebarNav({
  sections,
  root,
  footer,
  subtitle,
  onNavigate,
  searchHref,
  headerExtra,
}: {
  headerExtra?: React.ReactNode;
  sections: NavSection[];
  root: string;
  footer?: React.ReactNode;
  subtitle?: string;
  onNavigate?: () => void;
  searchHref?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-5">
      <div className="flex items-center justify-between gap-2 px-2 pr-10 lg:pr-0">
        <Logo subtitle={subtitle} />
        {headerExtra}
      </div>
      {searchHref ? (
        <form
          className="relative px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            router.push(`${searchHref}?q=${encodeURIComponent(String(q ?? ""))}`);
            onNavigate?.();
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-subtle" />
          <input
            name="q"
            placeholder="Pesquisar colaborador"
            aria-label="Pesquisar colaborador"
            className="h-10 w-full rounded-md border border-transparent bg-background pr-3 pl-9 text-[13px] placeholder:text-subtle focus:border-primary/40 focus:outline-none"
          />
        </form>
      ) : null}
      <nav className="-mr-1 flex-1 space-y-5 overflow-y-auto pr-1" aria-label="Navegação principal">
        {sections.map((section, i) => (
          <div key={i}>
            {section.title ? <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wide text-subtle uppercase">{section.title}</p> : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <Item key={item.href} item={item} pathname={pathname} root={root} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {footer}
    </div>
  );
}
