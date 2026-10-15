"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="mt-8 space-y-4">
      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required placeholder="nome@empresa.co.mz" />
      </Field>
      <Field label="Palavra-passe" htmlFor="password">
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-subtle hover:text-foreground"
            aria-label={show ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="A entrar…">
        Entrar
      </SubmitButton>
    </form>
  );
}
