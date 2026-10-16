"use client";

import { Dialog as D } from "radix-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { AssistantFab } from "@/components/ai/orbi-eye";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { NavIcon } from "./nav-icon";
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
  /** Página do assistente: mostra o botão flutuante com o olho do Orbi. */
  assistantHref?: string;
  children: React.ReactNode;
};

export function AppShell({ sections, root, subtitle, user, notifications, mobileTabs, searchHref, centerAction, assistantHref, children }: Props) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const tabs = centerAction ? mobileTabs.slice(0, 4) : mobileTabs.slice(0, 3);

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* Barra lateral (desktop): sobre o fundo lilás, sem caixa. */}
      <aside className="hidden w-[260px] shrink-0 bg-[#16131f] text-white lg:block">
        <div className="sticky top-0 h-dvh">
          <SidebarNav
            sections={sections}
            root={root}
            subtitle={subtitle}
            searchHref={searchHref}
            headerExtra={<NotificationBell {...notifications} dark />}
            footer={<UserMenu {...user} dark />}
          />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Barra superior (telemóvel/tablet) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-[#16131f] px-4 text-white lg:hidden">
          <Link href={root} className="flex min-w-0 items-center gap-2.5" aria-label="Início">
            <LogoMark className="size-6 shrink-0" color="#ffffff" />
            <span className="truncate text-[14.5px] font-bold">{subtitle ?? "Horbit"}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell {...notifications} dark />
            <UserMenu {...user} compact />
          </div>
        </header>

        <main className="relative flex-1 pb-28 lg:pb-0">{children}</main>
      </div>

      {assistantHref ? <AssistantFab href={assistantHref} /> : null}

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
                  className="flex h-12 w-full max-w-[76px] flex-col items-center justify-center gap-0.5 rounded-xl bg-primary text-[11.5px] font-bold text-white"
                >
                  <NavIcon href="/app/marcar/" active className="size-[22px]" />
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
                <D.Trigger className="relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11.5px] font-bold text-muted">
                  <NavIcon href="menu" className="size-[22px]" />
                  Menu
                </D.Trigger>
                <D.Portal>
                  <D.Overlay className="fixed inset-0 z-50 bg-[#1a1530]/40 data-[state=open]:animate-fade-in" />
                  <D.Content className="fixed inset-y-0 left-0 z-50 w-[88vw] max-w-[320px] bg-[#16131f] text-white data-[state=open]:animate-slide-in-left">
                    <D.Title className="sr-only">Menu</D.Title>
                    <D.Description className="sr-only">Navegação completa</D.Description>
                    <D.Close className="absolute top-5 right-4 h-8 rounded-md bg-white/10 px-2.5 text-[13px] font-bold text-white">Fechar</D.Close>
                    <SidebarNav
                      sections={sections}
                      root={root}
                      subtitle={subtitle}
                      searchHref={searchHref}
                      onNavigate={() => setOpen(false)}
                      footer={<UserMenu {...user} dark />}
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
        className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11.5px] font-bold text-muted", active && "text-primary")}
      >
        <NavIcon href={item.href} active={active} className="size-[22px]" />
        <span
          aria-hidden
          className={cn("absolute top-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-primary transition-transform", active ? "scale-x-100" : "scale-x-0")}
        />
        {item.label}
      </Link>
    </li>
  );
}
