"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";
import { Button, type ButtonProps } from "./button";

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/**
 * Formulário ligado a uma operação assíncrona (Supabase): mostra o resultado em toast e
 * chama `onSuccess` (ex.: fechar o diálogo).
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
  const ref = React.useRef<HTMLFormElement>(null);
  const [state, formAction] = React.useActionState(action, null);
  const last = React.useRef<ActionResult | null>(null);

  React.useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    } else {
      toast.error(state.error);
    }
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
