"use client";

import Link from "next/link";
import * as React from "react";
import { PendingButton, SubmitForm } from "@/components/admin/submit-form";
import { FloatField } from "@/components/brand/float-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { attempt, formObject, type ActionResult } from "@/lib/result";
import { rpc } from "@/lib/sb/client";

async function submit(fd: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const o = formObject(fd);
    // Armadilha anti-spam: campo invisível que só os robôs preenchem.
    if (o.website) return { ok: true };
    if (!o.company_name || o.company_name.length < 2) throw new Error("Indique o nome da empresa.");
    if (!o.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error("Indique um email válido.");
    if (!o.message || o.message.trim().length < 10) throw new Error("Explique em poucas palavras porque pede o acesso.");
    await rpc("ps_submit_company_request", {
      p_company_name: o.company_name,
      p_contact_name: null,
      p_email: o.email.toLowerCase(),
      p_message: o.message,
    });
    return { ok: true };
  });
}

export function RequestForm() {
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (sent) {
    return (
      <div role="status" className="py-6">
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[32px]">Pedido enviado</h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
          Recebemos o pedido. Vamos responder para o email indicado a pedir os dados do responsável. Depois criamos a conta e
          enviamos o utilizador e a palavra-passe para esse email.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button size="lg" asChild>
            <Link href="/">Voltar à página inicial</Link>
          </Button>
          <Button size="lg" variant="ghost" asChild>
            <Link href="/login/">Entrar</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SubmitForm
      onSubmit={(fd) => {
        setError(null);
        return submit(fd);
      }}
      onSuccess={() => setSent(true)}
      onError={setError}
      className="space-y-8"
    >
      <div>
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[32px]">Pedir acesso para a empresa</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Só precisamos do nome da empresa, de um email e do motivo. Respondemos por email a pedir o resto dos dados.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border-l-4 border-danger bg-danger-soft px-4 py-3 text-[13.5px] font-bold text-[#8e1f27]">
          {error}
        </p>
      ) : null}

      <div className="space-y-4">
        <FloatField label="Nome da empresa" name="company_name" required minLength={2} maxLength={160} autoComplete="organization" />
        <FloatField label="Email da empresa" name="email" type="email" required autoComplete="email" inputMode="email" />
        <div>
          <label htmlFor="request-message" className="mb-1.5 block text-[13.5px] font-bold">
            Porque pede o acesso?
          </label>
          <Textarea
            id="request-message"
            name="message"
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            placeholder="Ex.: Somos uma loja com 20 pessoas e queremos controlar o ponto e os salários."
          />
        </div>
      </div>

      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <PendingButton size="lg" className="w-full" pendingText="A enviar o pedido…">
        Enviar pedido
      </PendingButton>
    </SubmitForm>
  );
}
