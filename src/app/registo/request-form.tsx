"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { requestAccountAction } from "./actions";

export function RequestForm({ plans, selected }: { plans: { id: string; label: string }[]; selected: string }) {
  const [state, action] = useActionState(requestAccountAction, null);
  if (state?.ok) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-7" /></span>
        <p className="mt-5 text-[18px] font-semibold">Pedido recebido</p>
        <p className="mt-2 max-w-sm text-[14px] text-muted">Vamos validar os dados e enviar as credenciais do proprietário para o email indicado.</p>
        <Button variant="outline" className="mt-6" asChild><Link href="/">Voltar à página inicial</Link></Button>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state && !state.ok ? <Notice tone="danger" className="sm:col-span-2">{state.error}</Notice> : null}
      <Field label="Nome da empresa" className="sm:col-span-2"><Input name="companyName" required autoComplete="organization" /></Field>
      <Field label="NUIT"><Input name="nuit" inputMode="numeric" /></Field>
      <Field label="Cidade"><Input name="city" defaultValue="Maputo" /></Field>
      <Field label="Nome do responsável"><Input name="contactName" required autoComplete="name" /></Field>
      <Field label="Email do responsável" hint="Será o login do proprietário."><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Telefone"><Input name="phone" type="tel" placeholder="+258 84 …" autoComplete="tel" /></Field>
      <Field label="Nº de colaboradores"><Input name="employeesEstimate" type="number" min={1} /></Field>
      {plans.length ? (
        <Field label="Plano" className="sm:col-span-2">
          <Select name="planId" defaultValue={selected}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      ) : null}
      <Field label="Mensagem (opcional)" className="sm:col-span-2"><Textarea name="message" maxLength={1000} placeholder="Filiais, turnos, necessidades específicas…" /></Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="sm:col-span-2">
        <SubmitButton size="lg" className="w-full" pendingText="A enviar…">Enviar pedido</SubmitButton>
        <p className="mt-3 text-center text-xs text-muted">Já tem conta? <Link href="/login" className="font-medium text-primary">Entrar</Link></p>
      </div>
    </form>
  );
}
