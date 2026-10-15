"use client";

import { Copy, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import type { OrgOptions } from "@/lib/queries/org";
import { createEmployeeAction } from "./actions";

export function NewEmployee({ org, canSetSalary }: { org: OrgOptions; canSetSalary: boolean }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ id: string; temporaryPassword: string | null; email: string | null } | null>(null);
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCreated(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Novo colaborador
        </Button>
      </DialogTrigger>
      <DialogContent title={created ? "Colaborador criado" : "Novo colaborador"} description={created ? undefined : "Ficha, contrato, horário e (opcionalmente) conta de acesso."} wide>
        {created ? (
          <div className="space-y-4">
            {created.temporaryPassword ? (
              <Notice tone="warning" title="Palavra-passe temporária (mostrada apenas uma vez)">
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                  <span className="break-all">{created.temporaryPassword}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(created.temporaryPassword!);
                      toast.success("Copiada.");
                    }}
                    aria-label="Copiar"
                    className="text-muted hover:text-foreground"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
                <p className="mt-2">Entregue-a ao colaborador ({created.email}) por um canal seguro e peça para a alterar no primeiro acesso.</p>
              </Notice>
            ) : (
              <p className="text-[13px] text-muted">A ficha foi criada.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreated(null)}>Criar outro</Button>
              <Button onClick={() => router.push(`/empresa/colaboradores/${created.id}`)}>Abrir ficha</Button>
            </div>
          </div>
        ) : (
          <ActionForm
            action={createEmployeeAction}
            onSuccess={(r) => {
              if (r.ok && r.data) setCreated(r.data as { id: string; temporaryPassword: string | null; email: string | null });
              router.refresh();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label="Nome completo" className="sm:col-span-2">
              <Input name="fullName" required minLength={3} autoComplete="off" />
            </Field>
            <Field label="Nº mecanográfico">
              <Input name="employeeCode" required maxLength={30} />
            </Field>
            <Field label="Função">
              <Input name="jobTitle" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" />
            </Field>
            <Field label="Telefone">
              <Input name="phone" type="tel" placeholder="+258 84 …" />
            </Field>
            <Field label="Departamento">
              <Select name="departmentId" defaultValue="">
                <option value="">—</option>
                {org.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Filial">
              <Select name="branchId" defaultValue="">
                <option value="">—</option>
                {org.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Data de admissão">
              <Input name="hireDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="NUIT">
              <Input name="nuit" inputMode="numeric" />
            </Field>
            <Field label="Tipo de contrato">
              <Select name="contractType" defaultValue="indeterminado">
                <option value="indeterminado">Prazo indeterminado</option>
                <option value="determinado">Prazo determinado</option>
                <option value="estagio">Estágio</option>
                <option value="prestacao_servicos">Prestação de serviços</option>
              </Select>
            </Field>
            <Field label="Horas semanais">
              <Input name="weeklyHours" type="number" min={1} max={72} defaultValue={40} />
            </Field>
            <Field label="Horário">
              <Select name="scheduleId" defaultValue="">
                <option value="">Atribuir mais tarde</option>
                {org.schedules.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            {canSetSalary ? (
              <Field label="Salário base mensal (MZN)">
                <Input name="salary" inputMode="decimal" placeholder="25000.00" />
              </Field>
            ) : null}
            <label className="flex items-center gap-2.5 text-[13px] sm:col-span-2">
              <Checkbox name="createAccount" defaultChecked /> Criar conta de acesso para marcar ponto (requer email)
            </label>
            <div className="flex justify-end sm:col-span-2">
              <SubmitButton pendingText="A criar…">Criar colaborador</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
