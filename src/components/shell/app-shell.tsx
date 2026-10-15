"use client";

import { Dialog as D } from "radix-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import type { NavItem, NavSection } from "./nav-types";
import { NotificationBell, type NotificationView } from "./notification-bell";
import { isActive, SidebarNav } from "./sidebar";
import { UserMenu, type UserMenuProps } from "./user-menu";

type Props = {
  sections: NavSection[];
  root: string;
  subtitle?: string;
  user: UserMenuProps;
  notifications: { items: NotificationView[]; unread: number; onMarkRead: () => void };
  /** Atalhos da barra inferior no telemóvel (máx. 4). */
  mobileTabs: NavItem[];
  searchHref?: string;
  /** Acção central destacada (ex.: Marcar ponto). */
  centerAction?: { href: string; label: string };
  children: React.ReactNode;
};

export function AppShell({ sections, root, subtitle, user, notifications, mobileTabs, searchHref, centerAction, children }: Props) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const tabs = centerAction ? mobileTabs.slice(0, 4) : mobileTabs.slice(0, 3);

  return (
    <div className="min-h-dvh bg-canvas lg:flex lg:gap-3 lg:p-3">
      {/* Barra lateral (desktop): sobre o fundo lilás, sem caixa. */}
      <aside className="hidden w-[272px] shrink-0 lg:block">
        <div className="sticky top-3 h-[calc(100dvh-24px)]">
          <SidebarNav
            sections={sections}
            root={root}
            subtitle={subtitle}
            searchHref={searchHref}
            headerExtra={<NotificationBell {...notifications} />}
            footer={<UserMenu {...user} />}
          />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-background lg:min-h-[calc(100dvh-24px)] lg:rounded-[28px]">
        {/* Barra superior (telemóvel/tablet) */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
          <Link href={root} className="flex min-w-0 items-center gap-2.5" aria-label="Início">
            <LogoMark className="size-7 shrink-0" />
            <span className="truncate text-[15px] font-extrabold">{subtitle ?? "Horbit"}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell {...notifications} />
            <UserMenu {...user} compact />
          </div>
        </header>

        <main className="relative flex-1 pb-28 lg:pb-0">{children}</main>
      </div>

      {/* Navegação inferior (telemóvel): só texto, haste por cima do activo. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-safe backdrop-blur lg:hidden" aria-label="Navegação rápida">
        <ul className={cn("mx-auto grid max-w-lg items-center px-2", centerAction ? "grid-cols-5" : "grid-cols-4")}>
          {(centerAction ? tabs.slice(0, 2) : tabs).map((t) => (
            <TabLink key={t.href} item={t} root={root} pathname={pathname} />
          ))}
          {centerAction ? (
            <>
              <li className="flex justify-center">
                <Link
                  href={centerAction.href}
                  className="flex h-12 w-full max-w-[84px] items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-white active:scale-95"
                >
                  Marcar
                </Link>
              </li>
              {tabs.slice(2, 4).map((t) => (
                <TabLink key={t.href} item={t} root={root} pathname={pathname} />
              ))}
            </>
          ) : (
            <li>
              <D.Root open={open} onOpenChange={setOpen}>
                <D.Trigger className="relative flex h-16 w-full items-center justify-center text-[13px] font-bold text-muted">Menu</D.Trigger>
                <D.Portal>
                  <D.Overlay className="fixed inset-0 z-50 bg-[#1a1530]/40 data-[state=open]:animate-fade-in" />
                  <D.Content className="fixed inset-y-0 left-0 z-50 w-[88vw] max-w-[340px] bg-canvas data-[state=open]:animate-slide-in-left">
                    <D.Title className="sr-only">Menu</D.Title>
                    <D.Description className="sr-only">Navegação completa</D.Description>
                    <D.Close className="absolute top-6 right-4 h-9 rounded-full bg-background px-3 text-[13px] font-bold">Fechar</D.Close>
                    <SidebarNav
                      sections={sections}
                      root={root}
                      subtitle={subtitle}
                      searchHref={searchHref}
                      onNavigate={() => setOpen(false)}
                      footer={<UserMenu {...user} />}
                    />
                  </D.Content>
                </D.Portal>
              </D.Root>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}

function TabLink({ item, root, pathname }: { item: NavItem; root: string; pathname: string }) {
  const active = isActive(pathname, item.href, root);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex h-16 items-center justify-center text-[13px] font-bold text-muted", active && "text-foreground")}
      >
        <span
          aria-hidden
          className={cn("absolute top-0 left-1/2 h-[4px] w-7 -translate-x-1/2 rounded-full bg-primary transition-transform", active ? "scale-x-100" : "scale-x-0")}
        />
        {item.label}
      </Link>
    </li>
  );
}
