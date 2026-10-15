"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";
import { Button, type ButtonProps } from "./button";

const PendingContext = React.createContext<boolean | null>(null);

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const ctx = React.useContext(PendingContext);
  const status = useFormStatus();
  const pending = ctx ?? status.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/**
 * Formulário ligado a uma operação assíncrona (Supabase): mostra o resultado em
 * toast e chama `onSuccess` (ex.: fechar o diálogo). Usa onSubmit, por isso os
 * campos só são limpos quando a operação corre bem (e `resetOnSuccess`).
 */
export function ActionForm({
  action,
  children,
  onSuccess,
  className,
  resetOnSuccess = true,
  confirm,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  onSuccess?: (result: ActionResult) => void;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        setPending(true);
        const r = await action(null, new FormData(form));
        setPending(false);
        if (r.ok) {
          if (r.message) toast.success(r.message);
          if (resetOnSuccess) form.reset();
          onSuccess?.(r);
        } else {
          toast.error(r.error);
        }
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}
