"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { verifyMfaAction } from "../../actions";

export function MfaForm({ next }: { next?: string }) {
  const [state, action] = useActionState(verifyMfaAction, null);
  return (
    <form action={action} className="mt-8 space-y-4">
      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Código" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className="h-12 text-center text-lg tracking-[0.4em] tabular" />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="A verificar…">
        Verificar
      </SubmitButton>
    </form>
  );
}
