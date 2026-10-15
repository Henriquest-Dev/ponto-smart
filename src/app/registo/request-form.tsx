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
    if (!o.contact_name || o.contact_name.length < 3) throw new Error("Indique o nome do responsável.");
    const employees = o.employees ? Number(o.employees) : null;
    await rpc("ps_submit_company_request", {
      p_company_name: o.company_name,
      p_contact_name: o.contact_name,
      p_email: (o.email ?? "").toLowerCase(),
      p_phone: o.phone ?? null,
      p_nuit: o.nuit ?? null,
      p_city: o.city ?? null,
      p_employees: employees && Number.isInteger(employees) && employees > 0 ? employees : null,
      p_plan_code: null,
      p_message: o.message ?? null,
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
          Recebemos o pedido. A equipa Horbit cria a conta da empresa e envia-lhe o utilizador e a palavra-passe do responsável.
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
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[32px]">Pedir conta para a empresa</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Deixe os dados da empresa e do responsável. Validamos o pedido e criamos o acesso do responsável.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border-l-4 border-danger bg-danger-soft px-4 py-3 text-[13.5px] font-bold text-[#8e1f27]">
          {error}
        </p>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="mb-3 text-[17px] font-bold tracking-[-0.01em]">Empresa</legend>
        <FloatField label="Nome da empresa" name="company_name" required minLength={2} maxLength={160} autoComplete="organization" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FloatField label="NUIT" name="nuit" inputMode="numeric" maxLength={20} />
          <FloatField label="Cidade" name="city" defaultValue="Maputo" maxLength={80} autoComplete="address-level2" />
        </div>
        <FloatField label="Número de colaboradores" name="employees" type="number" min={1} max={100000} inputMode="numeric" />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-[17px] font-bold tracking-[-0.01em]">Responsável</legend>
        <FloatField label="Nome do responsável" name="contact_name" required minLength={3} maxLength={120} autoComplete="name" />
        <div className="grid gap-4 sm:grid-cols-2">
          <FloatField label="Email" name="email" type="email" required autoComplete="email" />
          <FloatField label="Telefone" name="phone" type="tel" maxLength={30} autoComplete="tel" />
        </div>
        <div>
          <label htmlFor="request-message" className="mb-1.5 block text-[13.5px] font-bold">
            Mensagem <span className="font-normal text-muted">(opcional)</span>
          </label>
          <Textarea id="request-message" name="message" maxLength={1000} placeholder="Filiais, turnos ou necessidades específicas" />
        </div>
      </fieldset>

      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <PendingButton size="lg" className="w-full" pendingText="A enviar o pedido…">
        Enviar pedido
      </PendingButton>
    </SubmitForm>
  );
}
