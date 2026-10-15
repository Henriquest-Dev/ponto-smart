"use client";

import { Copy, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import type { CompanySettings } from "@/lib/db/schema";
import { addBranchAction, addDepartmentAction, changeRoleAction, inviteUserAction, saveCompanyAction, setDepartmentManagerAction } from "./actions";

type Company = { name: string; legalName: string | null; nuit: string | null; email: string | null; phone: string | null; address: string | null; timezone: string; currency: string; settings: CompanySettings };

export function CompanyForm({ company: c }: { company: Company }) {
  return (
    <ActionForm action={saveCompanyAction} resetOnSuccess={false} className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Dados da empresa</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome comercial"><Input name="name" defaultValue={c.name} required /></Field>
          <Field label="Denominação social"><Input name="legalName" defaultValue={c.legalName ?? ""} /></Field>
          <Field label="NUIT"><Input name="nuit" defaultValue={c.nuit ?? ""} /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
          <Field label="Telefone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
          <Field label="Morada"><Input name="address" defaultValue={c.address ?? ""} /></Field>
          <Field label="Fuso horário" hint="Por defeito Africa/Maputo"><Input name="timezone" defaultValue={c.timezone} required /></Field>
          <Field label="Moeda"><Input name="currency" defaultValue={c.currency} maxLength={3} required className="uppercase" /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Políticas</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Dispositivo de confiança" className="sm:col-span-2" hint="Factor adicional; numa PWA não identifica hardware de forma infalível.">
            <Select name="devicePolicy" defaultValue={c.settings.devicePolicy}>
              <option value="off">Não exigir</option>
              <option value="warn">Assinalar dispositivos desconhecidos</option>
              <option value="require">Exigir (desconhecidos vão para revisão)</option>
            </Select>
          </Field>
          <Field label="Fluxo de justificações" className="sm:col-span-2">
            <Select name="absenceFlow" defaultValue={c.settings.absenceFlow}>
              <option value="supervisor_then_hr">Supervisor e depois RH</option>
              <option value="single">Apenas RH</option>
            </Select>
          </Field>
          <Field label="Janela anti-duplicados (min)"><Input name="duplicateWindowMinutes" type="number" min={1} max={30} defaultValue={c.settings.duplicateWindowMinutes} /></Field>
          <Field label="Divisor do valor diário" hint="Pressuposto: 30. Confirmar com especialista."><Input name="payrollDailyDivisor" type="number" min={20} max={31} defaultValue={c.settings.payrollDailyDivisor} /></Field>
          <label className="flex items-center gap-2.5 text-[13px] sm:col-span-2"><Checkbox name="requireMfaForAdmins" defaultChecked={c.settings.requireMfaForAdmins} /> Exigir verificação em dois passos a proprietários, administradores, RH e financeiro</label>
        </CardContent>
      </Card>
      <div className="xl:col-span-2"><SubmitButton>Guardar definições</SubmitButton></div>
    </ActionForm>
  );
}

export function InviteUser({ canOwner }: { canOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPwd(null); }}>
      <DialogTrigger asChild><Button><UserPlus /> Adicionar utilizador</Button></DialogTrigger>
      <DialogContent title="Adicionar utilizador" description="Para colaboradores que marcam ponto, crie a ficha em Colaboradores.">
        {pwd ? (
          <Notice tone="warning" title="Palavra-passe temporária (mostrada uma vez)">
            <div className="mt-2 flex items-center justify-between rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
              {pwd}
              <button onClick={() => { void navigator.clipboard.writeText(pwd); toast.success("Copiada."); }} aria-label="Copiar"><Copy className="size-4" /></button>
            </div>
          </Notice>
        ) : (
          <ActionForm action={inviteUserAction} onSuccess={(r) => { const p = r.ok ? (r.data?.temporaryPassword as string | null) : null; if (p) setPwd(p); else setOpen(false); }} className="space-y-4">
            <Field label="Nome"><Input name="name" required /></Field>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Papel">
              <Select name="role" defaultValue="hr">
                {canOwner ? <option value="owner">Proprietário</option> : null}
                <option value="admin">Administrador</option>
                <option value="hr">Recursos Humanos</option>
                <option value="finance">Financeiro</option>
                <option value="supervisor">Supervisor</option>
                <option value="employee">Colaborador</option>
              </Select>
            </Field>
            <SubmitButton className="w-full">Adicionar</SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RoleSelect({ membershipId, role, canOwner }: { membershipId: string; role: string; canOwner: boolean }) {
  return (
    <ActionForm action={changeRoleAction} resetOnSuccess={false}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <Select
        name="role"
        defaultValue={role}
        className="h-9 w-48"
        disabled={role === "owner" && !canOwner}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        aria-label="Papel"
      >
        {canOwner || role === "owner" ? <option value="owner">Proprietário</option> : null}
        <option value="admin">Administrador</option>
        <option value="hr">Recursos Humanos</option>
        <option value="finance">Financeiro</option>
        <option value="supervisor">Supervisor</option>
        <option value="employee">Colaborador</option>
        <option value="disabled">Desactivar acesso</option>
      </Select>
    </ActionForm>
  );
}

export function AddBranch() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="soft"><Plus /> Filial</Button></DialogTrigger>
      <DialogContent title="Nova filial">
        <ActionForm action={addBranchAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <Field label="Nome"><Input name="name" required /></Field>
          <Field label="Cidade"><Input name="city" /></Field>
          <Field label="Morada"><Input name="address" /></Field>
          <SubmitButton className="w-full">Criar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function AddDepartment({ branches, managers }: { branches: { id: string; name: string }[]; managers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="soft"><Plus /> Departamento</Button></DialogTrigger>
      <DialogContent title="Novo departamento">
        <ActionForm action={addDepartmentAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <Field label="Nome"><Input name="name" required /></Field>
          <Field label="Filial"><Select name="branchId" defaultValue=""><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Supervisor responsável"><Select name="managerUserId" defaultValue=""><option value="">—</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <SubmitButton className="w-full">Criar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentManager({ id, managerUserId, managers }: { id: string; managerUserId: string | null; managers: { id: string; name: string }[] }) {
  return (
    <ActionForm action={setDepartmentManagerAction} resetOnSuccess={false}>
      <input type="hidden" name="id" value={id} />
      <Select name="managerUserId" defaultValue={managerUserId ?? ""} className="h-9 w-52" onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Supervisor responsável">
        <option value="">Sem supervisor</option>
        {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </Select>
    </ActionForm>
  );
}
