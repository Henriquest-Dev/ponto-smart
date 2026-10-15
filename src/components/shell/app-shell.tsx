"use client";

import { Dialog as D } from "radix-ui";
import { Menu, ScanLine, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./icons";
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
  /** Atalhos da barra inferior no telemóvel (máx. 4; o 5.º é "Menu"). */
  mobileTabs: NavItem[];
  searchHref?: string;
  /** Acção central destacada (ex.: Marcar ponto) — substitui o botão "Menu". */
  centerAction?: { href: string; label: string };
  children: React.ReactNode;
};

export function AppShell({ sections, root, subtitle, user, notifications, mobileTabs, searchHref, centerAction, children }: Props) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-dvh lg:p-3">
      <div className="flex min-h-dvh bg-background lg:min-h-[calc(100dvh-24px)] lg:overflow-hidden lg:rounded-[22px] lg:shadow-panel">
        {/* Barra lateral (desktop) */}
        <aside className="hidden w-[260px] shrink-0 bg-surface lg:block">
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

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barra superior (telemóvel/tablet) */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
            <Link href={root} className="flex items-center gap-2" aria-label="Início">
              <LogoMark className="size-7" />
              <span className="max-w-[46vw] truncate text-[14px] font-semibold">{subtitle ?? "PontoSmart"}</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell {...notifications} />
              <UserMenu {...user} compact />
            </div>
          </header>

          <main className="relative flex-1 pb-24 lg:overflow-y-auto lg:pb-0">{children}</main>
        </div>
      </div>

      {/* Navegação inferior (telemóvel) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-safe backdrop-blur lg:hidden"
        aria-label="Navegação rápida"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {(centerAction ? mobileTabs.slice(0, 2) : mobileTabs.slice(0, 4)).map((t) => (
            <TabLink key={t.href} item={t} root={root} pathname={pathname} />
          ))}
          {centerAction ? (
            <>
              <li className="flex items-start justify-center">
                <Link
                  href={centerAction.href}
                  className="-mt-5 flex size-[60px] flex-col items-center justify-center rounded-2xl bg-primary text-white shadow-[0_8px_20px_-6px_rgb(112_65_236/0.6)] active:scale-95"
                  aria-label={centerAction.label}
                >
                  <ScanLine className="size-6" strokeWidth={2} />
                </Link>
              </li>
              {mobileTabs.slice(2, 4).map((t) => (
                <TabLink key={t.href} item={t} root={root} pathname={pathname} />
              ))}
            </>
          ) : (
          <li>
            <D.Root open={open} onOpenChange={setOpen}>
              <D.Trigger className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] text-muted">
                <Menu className="size-[22px]" strokeWidth={1.7} />
                Menu
              </D.Trigger>
              <D.Portal>
                <D.Overlay className="fixed inset-0 z-50 bg-[#11131f]/35 data-[state=open]:animate-fade-in" />
                <D.Content className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[320px] bg-surface shadow-panel data-[state=open]:animate-slide-in-left">
                  <D.Title className="sr-only">Menu</D.Title>
                  <D.Description className="sr-only">Navegação completa</D.Description>
                  <D.Close className="absolute top-5 right-4 rounded-md p-1.5 text-muted hover:bg-background" aria-label="Fechar menu">
                    <X className="size-5" />
                  </D.Close>
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
  const Icon = NAV_ICONS[item.icon];
  const active = isActive(pathname, item.href, root);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] text-muted", active && "font-medium text-primary")}
      >
        <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.7} />
        {item.label}
      </Link>
    </li>
  );
}
