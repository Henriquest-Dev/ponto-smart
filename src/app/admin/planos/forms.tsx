"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/input";
import { savePlanAction } from "../actions";

type Plan = { id: string; code: string; name: string; priceMonthly: string; maxEmployees: number; modules: string[] };

export function PlanEditor({ plan }: { plan?: Plan }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {plan ? <Button size="icon-sm" variant="ghost" aria-label="Editar plano"><Pencil /></Button> : <Button><Plus /> Novo plano</Button>}
      </DialogTrigger>
      <DialogContent title={plan ? "Editar plano" : "Novo plano"}>
        <ActionForm action={savePlanAction} onSuccess={() => setOpen(false)} resetOnSuccess={!plan} className="grid gap-4 sm:grid-cols-2">
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
          <Field label="Código"><Input name="code" defaultValue={plan?.code} required /></Field>
          <Field label="Nome"><Input name="name" defaultValue={plan?.name} required /></Field>
          <Field label="Preço mensal (MZN)"><Input name="priceMonthly" defaultValue={plan?.priceMonthly} inputMode="decimal" required /></Field>
          <Field label="Máx. colaboradores"><Input name="maxEmployees" type="number" min={1} defaultValue={plan?.maxEmployees} required /></Field>
          <Field label="Módulos" hint="Separados por vírgula" className="sm:col-span-2"><Input name="modules" defaultValue={plan?.modules.join(", ")} /></Field>
          <div className="sm:col-span-2"><SubmitButton className="w-full">Guardar</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
