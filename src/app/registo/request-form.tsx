"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { PendingButton, SubmitForm } from "@/components/admin/submit-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice, Skeleton } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";
import { attempt, formObject, type ActionResult } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";

type PublicPlan = { code: string; name: string; price_monthly: number | string; currency: string; max_employees: number };

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
      p_plan_code: o.plan_code ?? null,
      p_message: o.message ?? null,
    });
    return { ok: true };
  });
}

export function RequestForm() {
  const wanted = useSearchParams().get("plano");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const plans = useData(
    async () =>
      must(
        await sb()
          .from("subscription_plans")
          .select("code,name,price_monthly,currency,max_employees")
          .eq("active", true)
          .order("price_monthly"),
      ) as PublicPlan[],
    [],
  );

  if (sent) {
    return (
      <div className="flex flex-col items-center py-10 text-center" role="status">
        <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-7" />
        </span>
        <p className="mt-5 text-[18px] font-semibold">Pedido enviado</p>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
          Recebemos o pedido. A equipa PontoSmart cria a conta da empresa e envia o utilizador e a palavra-passe do responsável.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/">Voltar à página inicial</Link>
        </Button>
      </div>
    );
  }

  const list = plans.data ?? [];
  const selected = list.find((p) => p.code === wanted)?.code ?? list[1]?.code ?? list[0]?.code ?? "";

  return (
    <SubmitForm
      onSubmit={(fd) => {
        setError(null);
        return submit(fd);
      }}
      onSuccess={() => setSent(true)}
      onError={setError}
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h2 className="text-[17px] font-semibold tracking-tight">Dados do pedido</h2>
        <p className="mt-0.5 text-[13px] text-muted">Respondemos pelo email ou telefone indicados.</p>
      </div>
      {error ? (
        <Notice tone="danger" className="sm:col-span-2">
          {error}
        </Notice>
      ) : null}
      <Field label="Nome da empresa" className="sm:col-span-2">
        <Input name="company_name" required minLength={2} maxLength={160} autoComplete="organization" />
      </Field>
      <Field label="NUIT">
        <Input name="nuit" inputMode="numeric" maxLength={20} />
      </Field>
      <Field label="Cidade">
        <Input name="city" defaultValue="Maputo" maxLength={80} autoComplete="address-level2" />
      </Field>
      <Field label="Nome do responsável">
        <Input name="contact_name" required minLength={3} maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Email do responsável">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Telefone">
        <Input name="phone" type="tel" placeholder="+258 84 …" maxLength={30} autoComplete="tel" />
      </Field>
      <Field label="Nº de colaboradores">
        <Input name="employees" type="number" min={1} max={100000} inputMode="numeric" />
      </Field>
      <Field label="Plano" className="sm:col-span-2" hint={plans.error ? "Não foi possível carregar os planos. Pode enviar o pedido sem escolher." : undefined}>
        {plans.loading ? (
          <Skeleton className="h-10" />
        ) : (
          <Select key={selected} name="plan_code" defaultValue={selected} disabled={!list.length}>
            {list.length ? null : <option value="">A definir com a equipa</option>}
            {list.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {formatMoney(p.price_monthly, p.currency)}/mês · até {p.max_employees} colaboradores
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Mensagem (opcional)" className="sm:col-span-2">
        <Textarea name="message" maxLength={1000} placeholder="Filiais, turnos, necessidades específicas…" />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="sm:col-span-2">
        <PendingButton size="lg" className="w-full" pendingText="A enviar…">
          Enviar pedido
        </PendingButton>
        <p className="mt-3 text-center text-xs text-muted">
          Já tem conta?{" "}
          <Link href="/login/" className="font-medium text-primary">
            Entrar
          </Link>
        </p>
      </div>
    </SubmitForm>
  );
}
