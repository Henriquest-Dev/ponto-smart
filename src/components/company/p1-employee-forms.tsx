"use client";

import { KeyRound, Pencil, Plus, UserCog } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { attempt, formObject, type ActionResult } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { CredentialFields, CredentialsCard, RoleSelect, suggestLogin, todayIn, validLogin, type OrgOptions } from "./p1-shared";

export type EmployeeRecord = {
  id: string;
  company_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  department_id: string | null;
  branch_id: string | null;
  hire_date: string | null;
  status: "active" | "inactive" | "terminated";
  nuit: string | null;
  bank_account: string | null;
};

const num = (v: string | undefined) => (v ? Number(v.replace(/\s/g, "").replace(",", ".")) : NaN);

export function EditEmployee({ employee: e, org, onSaved }: { employee: EmployeeRecord; org: OrgOptions; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil /> Editar ficha
        </Button>
      </DialogTrigger>
      <DialogContent title="Editar ficha" wide>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              if (!o.fullName || o.fullName.length < 3) throw new Error("Indique o nome completo.");
              const patch = {
                full_name: o.fullName,
                email: o.email?.toLowerCase() ?? null,
                phone: o.phone ?? null,
                job_title: o.jobTitle ?? null,
                department_id: o.departmentId ?? null,
                branch_id: o.branchId ?? null,
                hire_date: o.hireDate ?? null,
                status: o.status ?? "active",
                nuit: o.nuit ?? null,
                bank_account: o.bankAccount ?? null,
              };
              const rows = must(await sb().from("employees").update(patch).eq("id", e.id).select("id"));
              if (!rows?.length) throw new Error("Sem permissão para editar este colaborador.");
              return "Ficha actualizada.";
            })
          }
          onSuccess={() => {
            setOpen(false);
            onSaved();
          }}
          resetOnSuccess={false}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Nome completo" className="sm:col-span-2">
            <Input name="fullName" defaultValue={e.full_name} required minLength={3} />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={e.email ?? ""} />
          </Field>
          <Field label="Telefone">
            <Input name="phone" type="tel" defaultValue={e.phone ?? ""} />
          </Field>
          <Field label="Função">
            <Input name="jobTitle" defaultValue={e.job_title ?? ""} />
          </Field>
          <Field label="NUIT">
            <Input name="nuit" inputMode="numeric" defaultValue={e.nuit ?? ""} />
          </Field>
          <Field label="Departamento">
            <Select name="departmentId" defaultValue={e.department_id ?? ""}>
              <option value="">—</option>
              {org.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Filial">
            <Select name="branchId" defaultValue={e.branch_id ?? ""}>
              <option value="">—</option>
              {org.branches.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Data de admissão">
            <Input name="hireDate" type="date" defaultValue={e.hire_date ?? ""} />
          </Field>
          <Field label="Conta bancária / NIB">
            <Input name="bankAccount" defaultValue={e.bank_account ?? ""} />
          </Field>
          <Field label="Estado" hint="Inactivo ou cessado bloqueia o acesso ao PontoSmart.">
            <Select name="status" defaultValue={e.status}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="terminated">Cessado</option>
            </Select>
          </Field>
          <div className="flex items-end justify-end">
            <SubmitButton>Guardar</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function SmallDialog({
  label,
  title,
  description,
  action,
  onDone,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  onDone: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <ActionForm
          action={action}
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
          className="space-y-4"
        >
          {children}
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function NewSalary({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const { tz, company } = useCompany();
  return (
    <SmallDialog
      label="Novo acordo"
      title="Novo acordo salarial"
      description="O acordo anterior termina no dia anterior à nova vigência. O histórico é mantido."
      onDone={onDone}
      action={(_p, fd) =>
        attempt(async () => {
          const o = formObject(fd);
          const amount = num(o.amount);
          if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor inválido.");
          await rpc("ps_add_salary", { p_employee: employeeId, p_amount: amount, p_from: o.effectiveFrom });
          return "Novo acordo salarial registado.";
        })
      }
    >
      <Field label={`Salário base mensal (${company.currency})`}>
        <Input name="amount" inputMode="decimal" required placeholder="30000.00" />
      </Field>
      <Field label="Em vigor a partir de">
        <Input name="effectiveFrom" type="date" required defaultValue={todayIn(tz)} />
      </Field>
    </SmallDialog>
  );
}

export function AssignSchedule({ employeeId, schedules, onDone }: { employeeId: string; schedules: { id: string; name: string }[]; onDone: () => void }) {
  const { tz } = useCompany();
  return (
    <SmallDialog
      label="Alterar"
      title="Atribuir horário"
      description="O horário anterior termina no dia anterior. Os dias seguintes são recalculados com o novo horário."
      onDone={onDone}
      action={(_p, fd) =>
        attempt(async () => {
          const o = formObject(fd);
          if (!o.scheduleId) throw new Error("Escolha um horário.");
          await rpc("ps_assign_schedule", { p_employee: employeeId, p_schedule: o.scheduleId, p_from: o.validFrom });
          return "Horário atribuído.";
        })
      }
    >
      {schedules.length ? null : <Notice tone="warning">Ainda não há horários. Crie-os em Horários e feriados.</Notice>}
      <Field label="Horário">
        <Select name="scheduleId" required defaultValue="">
          <option value="" disabled>
            Escolha…
          </option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Válido a partir de">
        <Input name="validFrom" type="date" required defaultValue={todayIn(tz)} />
      </Field>
    </SmallDialog>
  );
}

export function AssignComponent({
  employeeId,
  components,
  onDone,
}: {
  employeeId: string;
  components: { id: string; name: string; nature: string }[];
  onDone: () => void;
}) {
  const { tz, companyId, company } = useCompany();
  return (
    <SmallDialog
      label="Atribuir"
      title="Atribuir rubrica"
      description="Subsídios, adiantamentos ou descontos autorizados por escrito."
      onDone={onDone}
      action={(_p, fd) =>
        attempt(async () => {
          const o = formObject(fd);
          const amount = num(o.amount);
          if (!o.componentId) throw new Error("Escolha a rubrica.");
          if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor inválido.");
          if (o.effectiveTo && o.effectiveFrom && o.effectiveTo < o.effectiveFrom) throw new Error("A data final não pode ser anterior à inicial.");
          must(
            await sb().from("employee_components").insert({
              company_id: companyId,
              employee_id: employeeId,
              component_id: o.componentId,
              amount: Math.round(amount * 100) / 100,
              effective_from: o.effectiveFrom,
              effective_to: o.effectiveTo ?? null,
              note: o.note ?? null,
            }),
          );
          return "Rubrica atribuída.";
        })
      }
    >
      <Field label="Rubrica">
        <Select name="componentId" required defaultValue="">
          <option value="" disabled>
            Escolha…
          </option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.nature === "earning" ? "abono" : "desconto"})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Valor mensal (${company.currency})`}>
        <Input name="amount" inputMode="decimal" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="De">
          <Input name="effectiveFrom" type="date" required defaultValue={todayIn(tz)} />
        </Field>
        <Field label="Até (opcional)">
          <Input name="effectiveTo" type="date" />
        </Field>
      </div>
      <Field label="Nota / autorização">
        <Input name="note" maxLength={200} />
      </Field>
    </SmallDialog>
  );
}

/** Criar acesso, repor palavra-passe ou alterar utilizador/papel. */
export function AccessDialog({
  mode,
  employee,
  currentLogin,
  currentRole,
  onDone,
}: {
  mode: "create" | "reset" | "edit" | "reactivate";
  employee: EmployeeRecord;
  currentLogin: string | null;
  currentRole: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ login: string; password: string | null } | null>(null);
  const meta = {
    create: { button: "Criar acesso", title: "Criar acesso ao PontoSmart", variant: "primary" as const, icon: <KeyRound /> },
    reset: { button: "Repor palavra-passe", title: "Repor palavra-passe", variant: "outline" as const, icon: <KeyRound /> },
    edit: { button: "Alterar utilizador ou papel", title: "Alterar utilizador ou papel", variant: "outline" as const, icon: <UserCog /> },
    reactivate: { button: "Reactivar acesso", title: "Reactivar acesso", variant: "primary" as const, icon: <KeyRound /> },
  }[mode];
  const description = {
    create: "Defina o utilizador e a palavra-passe que vai entregar ao colaborador.",
    reset: "Defina uma nova palavra-passe. A anterior deixa de funcionar de imediato.",
    edit: "O colaborador passa a entrar com o novo utilizador. A palavra-passe mantém-se se deixar o campo em branco.",
    reactivate: "Volta a permitir a entrada. Pode definir uma nova palavra-passe.",
  }[mode];
  // Recarregar a ficha só ao fechar: a recarga pode trocar este botão por outro e perder as credenciais no ecrã.
  const close = () => {
    setOpen(false);
    if (result) onDone();
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button size="sm" variant={meta.variant}>
          {meta.icon} {meta.button}
        </Button>
      </DialogTrigger>
      <DialogContent title={result ? "Credenciais do colaborador" : meta.title} description={result ? employee.full_name : description}>
        {result ? (
          <div className="space-y-4">
            <CredentialsCard name={employee.full_name} login={result.login} password={result.password} />
            <Button className="w-full" onClick={close}>
              Concluído
            </Button>
          </div>
        ) : (
          <ActionForm
            action={(_p, fd) =>
              attempt(async () => {
                const o = formObject(fd);
                const login = (mode === "create" || mode === "edit" ? o.login : currentLogin)?.toLowerCase() ?? "";
                const password = ((fd.get("password") as string | null) ?? "").trim();
                const role = o.role ?? currentRole;
                if (!validLogin(login)) throw new Error("Utilizador inválido: use letras, números, ponto, hífen ou um email (mínimo 3 caracteres).");
                if ((mode === "create" || mode === "reset") && password.length < 8) throw new Error("A palavra-passe deve ter pelo menos 8 caracteres.");
                if (password && password.length < 8) throw new Error("A palavra-passe deve ter pelo menos 8 caracteres.");
                await rpc("ps_set_access", { p_employee: employee.id, p_login: login, p_password: password || null, p_role: role });
                return { ok: true, message: "Acesso guardado.", data: { login, password: password || null } };
              })
            }
            onSuccess={(r) => {
              if (r.ok && r.data) setResult(r.data as { login: string; password: string | null });
            }}
            resetOnSuccess={false}
            className="space-y-4"
          >
            <CredentialFields
              defaultLogin={mode === "create" ? suggestLogin(employee.full_name) : currentLogin ?? ""}
              showLogin={mode === "create" || mode === "edit"}
              passwordRequired={mode === "create" || mode === "reset"}
            />
            {mode === "create" || mode === "edit" ? <RoleSelect defaultValue={currentRole} /> : null}
            {employee.status !== "active" ? (
              <Notice tone="warning">O colaborador não está activo: o acesso fica guardado mas só funciona quando voltar a activo.</Notice>
            ) : null}
            <SubmitButton className="w-full" pendingText="A guardar…">
              {meta.button}
            </SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Corrigir a classificação de um dia de assiduidade. */
export function ClassifyDayDialog({
  dailyId,
  name,
  date,
  onDone,
  trigger,
}: {
  dailyId: string;
  name: string;
  date: string;
  onDone: () => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="ghost">
            Corrigir
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="Corrigir registo" description={`${name} · ${date}. A versão anterior fica guardada no histórico de correcções.`}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              await rpc("ps_classify_day", { p_daily: dailyId, p_status: o.status, p_reason: o.reason ?? "" });
              return "Registo corrigido e histórico guardado.";
            })
          }
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
          className="space-y-4"
        >
          <Field label="Classificação">
            <Select name="status" defaultValue="unjustified">
              <option value="unjustified">Falta injustificada</option>
              <option value="justified">Falta justificada</option>
              <option value="on_time">Presença regularizada (pontual)</option>
              <option value="present">Presente (sem horário)</option>
            </Select>
          </Field>
          <Field label="Motivo" hint="Obrigatório — fica no trilho de auditoria.">
            <Textarea name="reason" required minLength={3} />
          </Field>
          <SubmitButton className="w-full">Guardar correcção</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
