"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Dropdown, DropdownContent, DropdownTrigger } from "@/components/ui/dropdown";
import { markNotificationsReadAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

export type NotificationView = { id: string; title: string; body: string | null; link: string | null; when: string; unread: boolean };

export function NotificationBell({ items, unread }: { items: NotificationView[]; unread: number }) {
  const [pending, start] = useTransition();
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          className="relative inline-flex size-10 items-center justify-center rounded-md border border-border-strong bg-background text-muted hover:text-foreground"
          aria-label={unread ? `Notificações (${unread} por ler)` : "Notificações"}
        >
          <Bell className="size-[18px]" strokeWidth={1.7} />
          {unread ? (
            <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white tabular">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-[min(360px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {unread ? (
            <button
              disabled={pending}
              onClick={() => start(() => markNotificationsReadAction())}
              className="text-xs font-medium text-primary disabled:opacity-50"
            >
              Marcar como lidas
            </button>
          ) : null}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">Sem notificações.</p>
          ) : (
            items.map((n) => {
              const content = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.unread ? "bg-primary" : "bg-transparent")} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{n.title}</span>
                    {n.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span> : null}
                    <span className="mt-1 block text-[11px] text-subtle">{n.when}</span>
                  </span>
                </>
              );
              return n.link ? (
                <Link key={n.id} href={n.link} className="flex gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-surface">
                  {content}
                </Link>
              ) : (
                <div key={n.id} className="flex gap-3 border-b border-border px-4 py-3 last:border-0">
                  {content}
                </div>
              );
            })
          )}
        </div>
      </DropdownContent>
    </Dropdown>
  );
}
