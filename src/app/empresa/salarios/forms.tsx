"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { createPeriodAction, registerAllPaymentsAction, registerPaymentAction } from "./actions";

const today = () => new Date().toISOString().slice(0, 10);

function Methods() {
  return (
    <Select name="method" defaultValue="transferencia">
      <option value="transferencia">Transferência bancária</option>
      <option value="mpesa">M-Pesa</option>
      <option value="emola">e-Mola</option>
      <option value="numerario">Numerário</option>
      <option value="cheque">Cheque</option>
    </Select>
  );
}

export function NewPeriod() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> Novo período</Button>
      </DialogTrigger>
      <DialogContent title="Novo período salarial">
        <ActionForm action={createPeriodAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <Field label="Mês"><Input type="month" name="month" required defaultValue={today().slice(0, 7)} /></Field>
          <SubmitButton className="w-full">Criar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function PayItem({ itemId, amount, name }: { itemId: string; amount: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">Registar</Button>
      </DialogTrigger>
      <DialogContent title="Registar pagamento" description={`${name}. O registo de pagamento é distinto da confirmação de recepção do recibo.`}>
        <ActionForm action={registerPaymentAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="payrollItemId" value={itemId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (MZN)"><Input name="amount" defaultValue={amount} inputMode="decimal" required /></Field>
            <Field label="Data"><Input type="date" name="paidAt" defaultValue={today()} required /></Field>
          </div>
          <Field label="Método"><Methods /></Field>
          <Field label="Referência"><Input name="reference" placeholder="Nº da transferência ou transacção" /></Field>
          <SubmitButton className="w-full">Registar pagamento</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function PayAll({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registar pagamentos</Button>
      </DialogTrigger>
      <DialogContent title="Registar pagamentos em lote" description="Regista o valor líquido de cada colaborador ainda sem pagamento.">
        <ActionForm action={registerAllPaymentsAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="runId" value={runId} />
          <Field label="Data do pagamento"><Input type="date" name="paidAt" defaultValue={today()} required /></Field>
          <Field label="Método"><Methods /></Field>
          <Field label="Referência do lote"><Input name="reference" placeholder="Ex.: lote bancário 2026-10" /></Field>
          <SubmitButton className="w-full">Registar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
