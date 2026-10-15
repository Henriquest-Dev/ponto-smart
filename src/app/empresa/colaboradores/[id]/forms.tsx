"use client";

import { Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import type { OrgOptions } from "@/lib/queries/org";
import type { ActionResult } from "@/lib/action";
import {
  addSalaryAction, assignComponentAction, assignScheduleAction, endComponentAction, revokeEmployeeDeviceAction, updateEmployeeAction,
} from "../actions";

type Emp = {
  id: string; fullName: string; email: string | null; phone: string | null; jobTitle: string | null;
  departmentId: string | null; branchId: string | null; nuit: string | null; status: "active" | "inactive" | "terminated";
};

const today = () => new Date().toISOString().slice(0, 10);

export function EditEmployee({ employee: e, org }: { employee: Emp; org: OrgOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pencil /> Editar ficha</Button>
      </DialogTrigger>
      <DialogContent title="Editar ficha" wide>
        <ActionForm action={updateEmployeeAction} onSuccess={() => setOpen(false)} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={e.id} />
          <Field label="Nome completo" className="sm:col-span-2"><Input name="fullName" defaultValue={e.fullName} required /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={e.email ?? ""} /></Field>
          <Field label="Telefone"><Input name="phone" defaultValue={e.phone ?? ""} /></Field>
          <Field label="Função"><Input name="jobTitle" defaultValue={e.jobTitle ?? ""} /></Field>
          <Field label="NUIT"><Input name="nuit" defaultValue={e.nuit ?? ""} /></Field>
          <Field label="Departamento">
            <Select name="departmentId" defaultValue={e.departmentId ?? ""}>
              <option value="">—</option>
              {org.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Filial">
            <Select name="branchId" defaultValue={e.branchId ?? ""}>
              <option value="">—</option>
              {org.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Estado">
            <Select name="status" defaultValue={e.status}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="terminated">Cessado</option>
            </Select>
          </Field>
          <div className="flex items-end justify-end sm:col-span-1"><SubmitButton>Guardar</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function SmallDialog({ label, title, description, action, children }: { label: string; title: string; description?: string; action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft"><Plus /> {label}</Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-4">
          {children}
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function NewSalary({ employeeId }: { employeeId: string }) {
  return (
    <SmallDialog label="Novo acordo" title="Novo acordo salarial" description="O acordo anterior termina no dia anterior à nova vigência. O histórico é mantido." action={addSalaryAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Field label="Salário base mensal (MZN)"><Input name="amount" inputMode="decimal" required placeholder="30000.00" /></Field>
      <Field label="Em vigor a partir de"><Input name="effectiveFrom" type="date" required defaultValue={today()} /></Field>
    </SmallDialog>
  );
}

export function AssignSchedule({ employeeId, schedules }: { employeeId: string; schedules: { id: string; name: string }[] }) {
  return (
    <SmallDialog label="Alterar" title="Atribuir horário" action={assignScheduleAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Field label="Horário">
        <Select name="scheduleId" required defaultValue="">
          <option value="" disabled>Escolha…</option>
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Válido a partir de"><Input name="validFrom" type="date" required defaultValue={today()} /></Field>
    </SmallDialog>
  );
}

export function AssignComponent({ employeeId, components }: { employeeId: string; components: { id: string; name: string; nature: string; rate: string | null }[] }) {
  return (
    <SmallDialog label="Atribuir" title="Atribuir rubrica" description="Subsídios, adiantamentos ou descontos autorizados por escrito." action={assignComponentAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Field label="Rubrica">
        <Select name="componentId" required defaultValue="">
          <option value="" disabled>Escolha…</option>
          {components.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.nature === "earning" ? "abono" : "desconto"})</option>)}
        </Select>
      </Field>
      <Field label="Valor mensal (MZN)"><Input name="amount" inputMode="decimal" required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="De"><Input name="effectiveFrom" type="date" required defaultValue={today()} /></Field>
        <Field label="Até (opcional)"><Input name="effectiveTo" type="date" /></Field>
      </div>
      <Field label="Nota / autorização"><Input name="note" maxLength={200} /></Field>
    </SmallDialog>
  );
}

function useAct() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito.");
      else toast.error(r.error);
    });
  return { pending, run };
}

export function EndComponent({ id, employeeId }: { id: string; employeeId: string }) {
  const { pending, run } = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Terminar esta rubrica hoje?") && run(() => endComponentAction(id, employeeId))}>Terminar</Button>;
}

export function RevokeEmployeeDevice({ id, employeeId }: { id: string; employeeId: string }) {
  const { pending, run } = useAct();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => revokeEmployeeDeviceAction(id, employeeId))}>Revogar</Button>;
}
