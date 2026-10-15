"use client";

import { Dialog as D } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[#1a1530]/40 data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          // Mobile: folha a subir do fundo; desktop: diálogo centrado.
          "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-[28px] bg-background p-5 pb-safe data-[state=open]:animate-slide-up",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:p-7",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
          className,
        )}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border-strong sm:hidden" />
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-[19px] font-extrabold tracking-[-0.01em]">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 h-9 shrink-0 rounded-full px-3 text-[13px] font-bold text-muted hover:bg-surface-2 hover:text-foreground">
            Fechar
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
