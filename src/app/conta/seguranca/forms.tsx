"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/input";
import { changePasswordAction, confirmMfaAction, disableMfaAction, startMfaSetupAction } from "../actions";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Palavra-passe actual" className="sm:col-span-2">
        <Input type="password" name="current" autoComplete="current-password" required />
      </Field>
      <Field label="Nova palavra-passe">
        <Input type="password" name="next" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirmar">
        <Input type="password" name="confirm" autoComplete="new-password" required minLength={10} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Alterar palavra-passe</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MfaSetup() {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!setup) {
    return (
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startMfaSetupAction();
            if (r.ok && r.data) setSetup(r.data as { qr: string; secret: string });
            else if (!r.ok) toast.error(r.error);
          })
        }
      >
        Configurar
      </Button>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR Code para a aplicação de autenticação" className="size-[220px] rounded-lg border border-border" />
      <div className="space-y-4">
        <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-muted">
          <li>Leia o QR Code com a aplicação de autenticação.</li>
          <li>
            Ou introduza a chave manualmente: <span className="font-mono text-xs break-all text-foreground">{setup.secret}</span>
          </li>
          <li>Introduza o código de 6 dígitos gerado.</li>
        </ol>
        <ActionForm action={confirmMfaAction} onSuccess={() => router.refresh()} className="flex gap-2">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={7} required className="max-w-40 tabular tracking-widest" />
          <SubmitButton>Activar</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

export function DisableMfa() {
  const router = useRouter();
  return (
    <ActionForm action={disableMfaAction} onSuccess={() => router.refresh()} className="flex flex-col gap-2 sm:flex-row" confirm="Desactivar a verificação em dois passos?">
      <Input type="password" name="password" placeholder="Confirme a palavra-passe" required className="sm:max-w-64" />
      <SubmitButton variant="danger-outline">Desactivar</SubmitButton>
    </ActionForm>
  );
}
