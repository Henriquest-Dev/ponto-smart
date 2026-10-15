"use client";

import Link from "next/link";
import { Dropdown, DropdownContent, DropdownTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

export type NotificationView = { id: string; title: string; body: string | null; link: string | null; when: string; unread: boolean };

/** Avisos: botão de texto com contador (sem sino). */
export function NotificationBell({ items, unread, onMarkRead, dark }: { items: NotificationView[]; unread: number; onMarkRead: () => void; dark?: boolean }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-bold transition-colors",
            dark ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-muted hover:bg-surface-2 hover:text-foreground",
          )}
          aria-label={unread ? `Avisos, ${unread} por ler` : "Avisos"}
        >
          Avisos
          {unread ? <span className="rounded bg-primary px-1.5 text-[11.5px] text-white tabular">{unread > 9 ? "9+" : unread}</span> : null}
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <p className="text-[15px] font-bold">Avisos</p>
          {unread ? (
            <button onClick={onMarkRead} className="h-8 rounded-md px-2.5 text-[12.5px] font-bold text-primary hover:bg-primary-soft">
              Marcar como lidos
            </button>
          ) : null}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-5 py-8 text-[13.5px] text-muted">Sem avisos por agora.</p>
          ) : (
            items.map((n) => {
              const content = (
                <>
                  <span className={cn("mt-1 h-4 w-[4px] shrink-0 rounded-full", n.unread ? "bg-primary" : "bg-transparent")} aria-hidden />
                  <span className="min-w-0">
                    <span className={cn("block text-[13.5px]", n.unread ? "font-bold" : "font-medium")}>{n.title}</span>
                    {n.body ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{n.body}</span> : null}
                    <span className="mt-1 block text-[11.5px] text-subtle">{n.when}</span>
                  </span>
                </>
              );
              return n.link ? (
                <Link key={n.id} href={n.link} className="flex gap-3 border-b border-border px-5 py-3.5 last:border-0 hover:bg-surface">
                  {content}
                </Link>
              ) : (
                <div key={n.id} className="flex gap-3 border-b border-border px-5 py-3.5 last:border-0">
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
