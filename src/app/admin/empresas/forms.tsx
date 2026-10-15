"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { changePlanAction, createCompanyAction } from "../actions";

export function NewCompany({ plans }: { plans: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPwd(null); }}>
      <DialogTrigger asChild><Button><Plus /> Nova empresa</Button></DialogTrigger>
      <DialogContent title="Nova empresa cliente" wide>
        {pwd ? (
          <Notice tone="warning" title="Palavra-passe temporária do proprietário (mostrada uma vez)">
            <p className="mt-2 rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">{pwd}</p>
          </Notice>
        ) : (
          <ActionForm action={createCompanyAction} onSuccess={(r) => { const p = r.ok ? (r.data?.temporaryPassword as string | null) : null; if (p) setPwd(p); else setOpen(false); }} className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da empresa"><Input name="name" required /></Field>
            <Field label="NUIT"><Input name="nuit" /></Field>
            <Field label="Email geral"><Input name="email" type="email" /></Field>
            <Field label="Plano"><Select name="planId" required>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Proprietário — nome"><Input name="ownerName" required /></Field>
            <Field label="Proprietário — email"><Input name="ownerEmail" type="email" required /></Field>
            <Field label="Dias experimentais" hint="0 = activa de imediato"><Input name="trialDays" type="number" min={0} max={90} defaultValue={30} /></Field>
            <div className="flex items-end"><SubmitButton className="w-full">Criar empresa</SubmitButton></div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ChangePlan({ subscriptionId, planId, status, plans }: { subscriptionId: string; planId: string; status: string; plans: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Plano</Button></DialogTrigger>
      <DialogContent title="Alterar subscrição">
        <ActionForm action={changePlanAction} onSuccess={() => setOpen(false)} resetOnSuccess={false} className="space-y-4">
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <Field label="Plano"><Select name="planId" defaultValue={planId}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Estado">
            <Select name="status" defaultValue={status}>
              <option value="trialing">Experimental</option>
              <option value="active">Activa</option>
              <option value="past_due">Em atraso</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </Field>
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
