"use client";

import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { attempt, formObject } from "@/lib/result";
import { rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { CredentialFields, CredentialsCard, RoleSelect, suggestLogin, todayIn, validLogin, type OrgOptions } from "./p1-shared";

type Created = { id: string; name: string; login: string | null; password: string | null };

export function NewEmployee({ org, onCreated }: { org: OrgOptions; onCreated: () => void }) {
  const { companyId, can, tz, company } = useCompany();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [withAccess, setWithAccess] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const canSalary = can("employees.salary.view");

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
      <DialogContent
        title={created ? "Colaborador criado" : "Novo colaborador"}
        description={created ? created.name : "Ficha, contrato, horário e credenciais de acesso ao PontoSmart."}
        wide
      >
        {created ? (
          <div className="space-y-4">
            {created.login ? (
              <CredentialsCard name={created.name} login={created.login} password={created.password} />
            ) : (
              <p className="text-[13px] text-muted">A ficha foi criada sem acesso. Pode criar as credenciais mais tarde, na ficha do colaborador.</p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setCreated(null)}>
                Criar outro
              </Button>
              <Button onClick={() => router.push(`/empresa/colaboradores/ficha/?id=${created.id}`)}>Abrir ficha</Button>
            </div>
          </div>
        ) : (
          <ActionForm
            action={(_prev, fd) =>
              attempt(async () => {
                const o = formObject(fd);
                const access = fd.get("withAccess") === "on";
                if (access) {
                  if (!o.login || !validLogin(o.login)) throw new Error("Utilizador inválido: use letras, números, ponto, hífen ou um email (mínimo 3 caracteres).");
                  if (!o.password || o.password.length < 8) throw new Error("A palavra-passe deve ter pelo menos 8 caracteres.");
                }
                const p: Record<string, string | undefined> = {
                  fullName: o.fullName,
                  employeeCode: o.employeeCode,
                  email: o.email,
                  phone: o.phone,
                  jobTitle: o.jobTitle,
                  departmentId: o.departmentId,
                  branchId: o.branchId,
                  hireDate: o.hireDate,
                  nuit: o.nuit,
                  contractType: o.contractType,
                  weeklyHours: o.weeklyHours,
                  scheduleId: o.scheduleId,
                };
                if (canSalary && o.salary) p.salary = o.salary.replace(/\s/g, "").replace(",", ".");
                if (access) {
                  p.login = o.login!.toLowerCase();
                  p.password = fd.get("password") as string;
                  p.role = o.role ?? "employee";
                }
                const id = await rpc<string>("ps_create_employee", { p_company: companyId, p });
                return {
                  ok: true,
                  message: "Colaborador criado.",
                  data: { id, name: o.fullName ?? "", login: access ? p.login : null, password: access ? p.password : null },
                };
              })
            }
            onSuccess={(r) => {
              if (r.ok && r.data) setCreated(r.data as Created);
              onCreated();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label="Nome completo" className="sm:col-span-2">
              <Input ref={nameRef} name="fullName" required minLength={3} autoComplete="off" />
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
                {org.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Filial">
              <Select name="branchId" defaultValue="">
                <option value="">—</option>
                {org.branches.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Data de admissão">
              <Input name="hireDate" type="date" required defaultValue={todayIn(tz)} />
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
                {org.schedules.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            {canSalary ? (
              <Field label={`Salário base mensal (${company.currency})`}>
                <Input name="salary" inputMode="decimal" placeholder="25000.00" />
              </Field>
            ) : null}

            <fieldset className="space-y-4 rounded-xl border border-border bg-surface/50 p-4 sm:col-span-2">
              <legend className="sr-only">Acesso ao PontoSmart</legend>
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">Acesso ao PontoSmart</p>
                  <p className="text-xs text-muted">
                    A empresa cria o utilizador e a palavra-passe e entrega-os ao colaborador. Com eles, ele marca ponto, consulta o histórico e os recibos.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2.5 text-[13px]">
                <Checkbox name="withAccess" checked={withAccess} onChange={(e) => setWithAccess(e.target.checked)} /> Criar acesso agora
              </label>
              {withAccess ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <CredentialFields suggestFrom={() => suggestLogin(nameRef.current?.value ?? "")} />
                  <RoleSelect />
                </div>
              ) : (
                <p className="text-xs text-muted">Pode criar o acesso mais tarde na ficha do colaborador.</p>
              )}
            </fieldset>

            <div className="flex justify-end sm:col-span-2">
              <SubmitButton pendingText="A criar…">Criar colaborador</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
