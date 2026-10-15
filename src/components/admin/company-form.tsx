"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";
import { attempt, formObject } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { CredentialsPanel, type Credentials } from "./credentials";
import { PendingButton, SubmitForm } from "./submit-form";
import { generatePassword, LOGIN_PATTERN, suggestLogin, type AdminRequest, type Plan } from "./data";

/** Campo de palavra-passe com "Gerar" e mostrar/ocultar. */
export function PasswordInput({ value, onChange, name = "password" }: { value: string; onChange: (v: string) => void; name?: string }) {
  const [show, setShow] = React.useState(true);
  return (
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          name={name}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
          spellCheck={false}
          className="pr-24 font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute top-1/2 right-1.5 h-8 -translate-y-1/2 rounded-md px-3 text-[12.5px] font-bold text-muted hover:bg-surface-2 hover:text-foreground"
          aria-pressed={!show}
        >
          {show ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>
        Gerar
      </Button>
    </div>
  );
}

function planLabel(p: Plan) {
  return `${p.name}, ${formatMoney(p.price_monthly, p.currency)} por mês, até ${p.max_employees} colaboradores${p.active ? "" : " (inactivo)"}`;
}

/**
 * Criação de uma empresa cliente (com a conta do responsável). Usado em "Nova empresa" e ao aprovar um pedido
 * (vem pré-preenchido e marca o pedido como aprovado). No fim mostra as credenciais para entregar.
 */
export function CompanyDialog({
  open,
  onOpenChange,
  plans,
  request,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: Plan[];
  request?: AdminRequest | null;
  onCreated: () => void;
}) {
  const [creds, setCreds] = React.useState<Credentials | null>(null);

  const close = () => onOpenChange(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCreds(null);
      }}
    >
      <DialogContent
        wide
        title={creds ? "Empresa criada" : request ? `Aprovar pedido de ${request.company_name}` : "Nova empresa cliente"}
        description={creds ? undefined : "Cria a empresa, a subscrição, um horário base e a conta do responsável (proprietário)."}
      >
        {creds ? (
          <CredentialsPanel creds={creds} onClose={close} />
        ) : open ? (
          <CompanyForm
            key={request?.id ?? "new"}
            plans={plans}
            request={request ?? null}
            onCreated={(c) => {
              setCreds(c);
              onCreated();
            }}
            onCancel={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompanyForm({
  plans,
  request,
  onCreated,
  onCancel,
}: {
  plans: Plan[];
  request: AdminRequest | null;
  onCreated: (c: Credentials) => void;
  onCancel: () => void;
}) {
  const requestPlan = request?.plan_id ? plans.find((p) => p.id === request.plan_id) : undefined;
  const options = plans.filter((p) => p.active || p.id === requestPlan?.id);
  const defaultPlan = requestPlan?.code ?? options[1]?.code ?? options[0]?.code ?? "";

  const [login, setLogin] = React.useState(request?.email?.toLowerCase() ?? "");
  const [loginTouched, setLoginTouched] = React.useState(!!request);
  const [password, setPassword] = React.useState(() => generatePassword());

  const action = (fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      const ownerLogin = login.trim().toLowerCase();
      if (!o.name || o.name.length < 2) throw new Error("Indique o nome da empresa.");
      if (!o.owner_name || o.owner_name.length < 3) throw new Error("Indique o nome do responsável.");
      if (!LOGIN_PATTERN.test(ownerLogin)) throw new Error("Acesso inválido: use letras, números, ponto, hífen ou um email (mínimo 3 caracteres).");
      if (password.length < 8) throw new Error("A palavra-passe deve ter pelo menos 8 caracteres.");
      const trial = Math.max(0, Math.min(90, Number(o.trial_days ?? 30) || 0));

      const existing = must(await sb().from("users").select("id").eq("email", ownerLogin).maybeSingle());
      if (existing) throw new Error(`O acesso "${ownerLogin}" já existe. Escolha outro utilizador para o responsável.`);

      await rpc<string>("ps_admin_create_company", {
        p_name: o.name,
        p_plan_code: o.plan_code ?? null,
        p_owner_name: o.owner_name,
        p_owner_login: ownerLogin,
        p_owner_password: password,
        p_nuit: o.nuit ?? null,
        p_email: o.email ?? null,
        p_phone: o.phone ?? null,
        p_trial_days: trial,
        p_request: request?.id ?? null,
      });
      const data: Credentials = { company: o.name, login: ownerLogin, password };
      return { ok: true, message: request ? "Pedido aprovado e empresa criada." : "Empresa criada.", data };
    });

  return (
    <SubmitForm
      onSubmit={action}
      onSuccess={(r) => {
        if (r.ok && r.data) onCreated(r.data as Credentials);
      }}
      className="space-y-6"
    >
      {request?.message ? (
        <Notice tone="info" title="Mensagem do pedido">
          <p className="whitespace-pre-line">{request.message}</p>
        </Notice>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]">
          <span className="stem text-primary" aria-hidden />
          Empresa
        </legend>
        <Field label="Nome da empresa" className="sm:col-span-2">
          <Input
            name="name"
            required
            minLength={2}
            defaultValue={request?.company_name}
            onChange={(e) => {
              if (!loginTouched) setLogin(suggestLogin(e.target.value));
            }}
          />
        </Field>
        <Field label="NUIT">
          <Input name="nuit" inputMode="numeric" defaultValue={request?.nuit ?? ""} />
        </Field>
        <Field label="Telefone">
          <Input name="phone" type="tel" defaultValue={request?.phone ?? ""} placeholder="+258 84 …" />
        </Field>
        <Field label="Email geral" className="sm:col-span-2">
          <Input name="email" type="email" defaultValue={request?.email ?? ""} />
        </Field>
        <Field label="Plano">
          <Select name="plan_code" defaultValue={defaultPlan} required>
            {options.map((p) => (
              <option key={p.id} value={p.code}>
                {planLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dias experimentais" hint="0 = activa de imediato">
          <Input name="trial_days" type="number" min={0} max={90} defaultValue={30} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl bg-surface p-4 sm:grid-cols-2 sm:p-5">
        <legend className="float-left mb-1 flex w-full items-center gap-2 text-[15px] font-bold tracking-[-0.01em] sm:col-span-2">
          <span className="stem text-primary" aria-hidden />
          Responsável da empresa
        </legend>
        <Field label="Nome" className="sm:col-span-2">
          <Input name="owner_name" required minLength={3} defaultValue={request?.contact_name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Utilizador ou email" hint="É com isto que o responsável entra.">
          <Input
            name="owner_login"
            required
            value={login}
            onChange={(e) => {
              setLoginTouched(true);
              setLogin(e.target.value.toLowerCase().replace(/\s+/g, ""));
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Palavra-passe" hint="Mínimo 8 caracteres.">
          <PasswordInput value={password} onChange={setPassword} name="owner_password" />
        </Field>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <PendingButton pendingText="A criar…">{request ? "Aprovar e criar conta" : "Criar empresa"}</PendingButton>
      </div>
    </SubmitForm>
  );
}
