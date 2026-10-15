"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NavIcon } from "./nav-icon";
import type { NavItem, NavSection } from "./nav-types";

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function isActive(rawPath: string, rawHref: string, rawRoot: string) {
  const pathname = trim(rawPath);
  const href = trim(rawHref.split("?")[0]);
  const root = trim(rawRoot);
  if (href === root) return pathname === root;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Haste activa à esquerda: o mesmo traço arredondado do logótipo. */
function ActiveStem({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 left-0 h-5 w-[4px] -translate-y-1/2 rounded-full bg-[#9d84f7] transition-[opacity,transform] duration-200",
        on ? "opacity-100" : "scale-y-0 opacity-0",
      )}
    />
  );
}

function Count({ n }: { n?: number }) {
  return n ? <span className="rounded-md bg-white/10 px-1.5 text-[12px] font-bold text-white tabular">{n}</span> : null;
}

function Item({ item, pathname, root, onNavigate }: { item: NavItem; pathname: string; root: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href, root);
  const [open, setOpen] = React.useState(active);
  React.useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const base = "relative flex h-10 w-full items-center gap-3 rounded-md pr-3 pl-4 text-[14.5px] transition-colors";
  if (item.children?.length) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(base, "text-white/70 hover:bg-white/5 hover:text-white", active && "font-bold text-white")}
        >
          <ActiveStem on={active} />
          <NavIcon href={item.href} active={active} className={active ? "text-[#b9a6fa]" : "text-white/55"} />
          <span className="flex-1 text-left">{item.label}</span>
          <Count n={item.badge} />
          <span aria-hidden className={cn("text-[15px] leading-none text-white/40 transition-transform", open && "rotate-90")}>
            ›
          </span>
        </button>
        {open ? (
          <ul className="mt-0.5 mb-1 ml-[25px] space-y-0.5 border-l border-white/15 pl-3">
            {item.children.map((c) => {
              const childActive = trim(pathname) === trim(c.href) || (c.href !== item.href && pathname.startsWith(c.href));
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex h-9 items-center rounded-md px-3 text-[13.5px] text-white/60 transition-colors hover:text-white",
                      childActive && "font-bold text-white",
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
        className={cn(base, "text-white/70 hover:bg-white/5 hover:text-white", active && "bg-white/[0.07] font-bold text-white")}
      >
        <ActiveStem on={active} />
        <NavIcon href={item.href} active={active} className={active ? "text-[#b9a6fa]" : "text-white/55"} />
        <span className="flex-1">{item.label}</span>
        <Count n={item.badge} />
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
    <div className="flex h-full flex-col gap-6 px-4 py-6">
      <div className="flex items-start justify-between gap-2 px-1 pr-14 lg:pr-0">
        <Link href={root} onClick={onNavigate} aria-label="Início">
          <Logo subtitle={subtitle} dark />
        </Link>
        {headerExtra}
      </div>
      {searchHref ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            router.push(`${searchHref}?q=${encodeURIComponent(String(q ?? ""))}`);
            onNavigate?.();
          }}
        >
          <input
            name="q"
            placeholder="Procurar colaborador"
            aria-label="Procurar colaborador"
            className="h-10 w-full rounded-md border border-white/10 bg-white/5 px-3 text-[14px] text-white placeholder:text-white/40 focus:border-[#9d84f7] focus:outline-none"
          />
        </form>
      ) : null}
      <nav className="-mr-1 flex-1 space-y-6 overflow-y-auto pr-1" aria-label="Navegação principal">
        {sections.map((section, i) => (
          <div key={i}>
            {section.title ? <p className="mb-1.5 px-4 text-[12px] font-medium text-white/40">{section.title}</p> : null}
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
