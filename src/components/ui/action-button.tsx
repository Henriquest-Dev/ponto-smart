"use client";

import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";
import { Button, type ButtonProps } from "./button";

/** Botão que executa uma operação assíncrona com confirmação opcional. */
export function ActionButton({ action, confirm, children, ...props }: Omit<ButtonProps, "onClick" | "action"> & { action: () => Promise<ActionResult>; confirm?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const r = await action();
          if (r.ok) {
            if (r.message) toast.success(r.message);
          } else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
