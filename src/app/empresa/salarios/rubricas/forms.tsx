"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { saveComponentAction, saveRuleVersionAction } from "../actions";

const today = () => new Date().toISOString().slice(0, 10);

export function NewComponent() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus /> Nova rubrica</Button>
      </DialogTrigger>
      <DialogContent title="Nova rubrica">
        <ActionForm action={saveComponentAction} onSuccess={() => setOpen(false)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Código"><Input name="code" required placeholder="SUB_TURNO" className="uppercase" /></Field>
          <Field label="Nome"><Input name="name" required placeholder="Subsídio de turno" /></Field>
          <Field label="Natureza">
            <Select name="nature" defaultValue="earning">
              <option value="earning">Abono</option>
              <option value="deduction">Desconto autorizado</option>
            </Select>
          </Field>
          <Field label="Cálculo">
            <Select name="calcType" defaultValue="fixed">
              <option value="fixed">Valor fixo</option>
              <option value="percent_base">% do salário base</option>
              <option value="per_hour">Por hora (horas extra)</option>
            </Select>
          </Field>
          <Field label="Valor de referência" hint="Fixo: MZN; %: percentagem; por hora: multiplicador."><Input name="rate" inputMode="decimal" /></Field>
          <Field label="Em vigor desde"><Input type="date" name="effectiveFrom" defaultValue={today()} required /></Field>
          <label className="flex items-center gap-2.5 text-[13px] sm:col-span-2"><Checkbox name="taxable" defaultChecked /> Entra na base das retenções</label>
          <div className="sm:col-span-2"><SubmitButton className="w-full">Criar rubrica</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function NewRuleVersion() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("employee_contribution");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus /> Nova versão de regra</Button>
      </DialogTrigger>
      <DialogContent title="Nova versão de regra" description="Cria uma nova versão; as anteriores ficam inalteradas para reprodutibilidade." wide>
        <ActionForm action={saveRuleVersionAction} onSuccess={() => setOpen(false)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Código da regra" hint="Ex.: INSS_TRAB, INSS_ENT, IRPS"><Input name="ruleCode" required className="uppercase" /></Field>
          <Field label="Nome"><Input name="name" required /></Field>
          <Field label="Natureza">
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="employee_contribution">Contribuição do trabalhador (%)</option>
              <option value="employer_contribution">Encargo da entidade (%)</option>
              <option value="income_tax">Imposto progressivo (escalões)</option>
            </Select>
          </Field>
          <Field label="Em vigor desde"><Input type="date" name="effectiveFrom" defaultValue={today()} required /></Field>
          {kind === "income_tax" ? (
            <Field label="Escalões (JSON)" className="sm:col-span-2" hint='[{"upTo": 20250, "ratePercent": 0, "deduction": 0}, {"upTo": null, "ratePercent": 32, "deduction": 0}] — valores ilustrativos'>
              <Textarea name="brackets" className="font-mono text-xs" required />
            </Field>
          ) : (
            <Field label="Taxa (%)"><Input name="ratePercent" inputMode="decimal" required /></Field>
          )}
          <Field label="Validado por" hint="Nome e cédula do especialista. Em branco = não aplicada."><Input name="validatedBy" /></Field>
          <Field label="Fonte legal" className="sm:col-span-2"><Input name="sourceReference" placeholder="Diploma, artigo, data de publicação" /></Field>
          <div className="sm:col-span-2"><SubmitButton className="w-full">Registar versão</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
