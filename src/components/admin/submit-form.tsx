"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/result";

const PendingContext = React.createContext(false);

/**
 * Como ActionForm, mas com onSubmit: o React não limpa os campos quando a operação falha
 * (com `<form action>` o React 19 repõe sempre o formulário no fim).
 */
export function SubmitForm({
  onSubmit,
  onSuccess,
  className,
  children,
  onError,
}: {
  onSubmit: (fd: FormData) => Promise<ActionResult>;
  onSuccess?: (r: ActionResult) => void;
  /** Por omissão o erro aparece num toast. */
  onError?: (message: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        const r = await onSubmit(new FormData(e.currentTarget));
        setPending(false);
        if (r.ok) {
          if (r.message) toast.success(r.message);
          onSuccess?.(r);
        } else if (onError) onError(r.error);
        else toast.error(r.error);
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}

export function PendingButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const pending = React.useContext(PendingContext);
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled}>
      {pending ? <span className="spinner" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
