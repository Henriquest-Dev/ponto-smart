"use client";

import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock, NoAccess } from "@/components/company/p2-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { attempt, formObject } from "@/lib/result";
import { errorMessage, must, sb } from "@/lib/sb/client";
import { useCompany, useSession, type CompanySettings } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

type TabKey = "empresa" | "utilizadores" | "organizacao";

export default function SettingsPage() {
  const { can } = useCompany();
  if (!can("company.settings.manage", "users.manage", "org.manage")) return <NoAccess title="Definições" />;
  return <Settings />;
}

function Settings() {
  const { can } = useCompany();
  const tabs: { key: TabKey; label: string }[] = [
    ...(can("company.settings.manage") ? [{ key: "empresa" as const, label: "Empresa e políticas" }] : []),
    ...(can("users.manage") ? [{ key: "utilizadores" as const, label: "Utilizadores e papéis" }] : []),
    ...(can("org.manage") ? [{ key: "organizacao" as const, label: "Filiais e departamentos" }] : []),
  ];
  const [tab, setTab] = React.useState<TabKey>(tabs[0].key);
  return (
    <>
      <PageHeader title="Definições" />
      <PageBody>
        <Tabs items={tabs} active={tab} onChange={setTab} />
        {tab === "empresa" ? <CompanyTab /> : tab === "utilizadores" ? <UsersTab /> : <OrgTab />}
      </PageBody>
    </>
  );
}

/* ------------------------------ Empresa ------------------------------ */

type CompanyRow = {
  name: string;
  legal_name: string | null;
  nuit: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  status: string;
  settings: CompanySettings & Record<string, unknown>;
};

function CompanyTab() {
  const { companyId } = useCompany();
  const { refresh } = useSession();
  const data = useData(async () => {
    const c = await sb().from("companies").select("name,legal_name,nuit,email,phone,address,timezone,currency,status,settings").eq("id", companyId).single();
    return { company: must(c) as CompanyRow };
  }, [companyId]);

  if (data.error) return <ErrorBlock message={data.error} />;
  if (!data.data) return <LoadingBlock rows={3} />;
  const c = data.data.company;
  const st = c.settings ?? {};

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const o = formObject(fd);
      if (!o.name || o.name.length < 2) throw new Error("Indique o nome da empresa.");
      if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error("Email inválido.");
      const dup = Number(o.duplicateWindowMinutes);
      const div = Number(o.payrollDailyDivisor);
      if (!Number.isInteger(dup) || dup < 1 || dup > 30) throw new Error("Janela anti-duplicados entre 1 e 30 minutos.");
      if (!Number.isInteger(div) || div < 20 || div > 31) throw new Error("Divisor do valor diário entre 20 e 31.");
      const settings = {
        ...st,
        devicePolicy: o.devicePolicy as CompanySettings["devicePolicy"],
        absenceFlow: o.absenceFlow as CompanySettings["absenceFlow"],
        duplicateWindowMinutes: dup,
        payrollDailyDivisor: div,
      };
      must(
        await sb()
          .from("companies")
          .update({
            name: o.name,
            legal_name: o.legalName ?? null,
            nuit: o.nuit ?? null,
            email: o.email ?? null,
            phone: o.phone ?? null,
            address: o.address ?? null,
            settings,
            updated_at: new Date().toISOString(),
          })
          .eq("id", companyId)
          .select("id"),
      );
      await refresh();
      data.reload();
      return "Definições guardadas.";
    });

  return (
    <div className="space-y-6">
      <ActionForm action={save} resetOnSuccess={false} className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Dados da empresa</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome comercial"><Input name="name" defaultValue={c.name} required /></Field>
            <Field label="Denominação social"><Input name="legalName" defaultValue={c.legal_name ?? ""} /></Field>
            <Field label="NUIT"><Input name="nuit" defaultValue={c.nuit ?? ""} inputMode="numeric" /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
            <Field label="Telefone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
            <Field label="Morada"><Input name="address" defaultValue={c.address ?? ""} /></Field>
            <Field label="Fuso horário" hint="Alterado apenas pelo suporte da plataforma."><Input value={c.timezone} disabled readOnly /></Field>
            <Field label="Moeda" hint="Alterada apenas pelo suporte da plataforma."><Input value={c.currency} disabled readOnly /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Políticas</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Dispositivo de confiança" className="sm:col-span-2" hint="Factor adicional; numa PWA não identifica hardware de forma infalível.">
              <Select name="devicePolicy" defaultValue={st.devicePolicy ?? "warn"}>
                <option value="off">Não exigir</option>
                <option value="warn">Assinalar dispositivos desconhecidos</option>
                <option value="require">Exigir (desconhecidos vão para revisão)</option>
              </Select>
            </Field>
            <Field label="Fluxo de justificações" className="sm:col-span-2">
              <Select name="absenceFlow" defaultValue={st.absenceFlow === "hr_only" ? "hr_only" : "supervisor_then_hr"}>
                <option value="supervisor_then_hr">Supervisor e depois RH</option>
                <option value="hr_only">Apenas RH</option>
              </Select>
            </Field>
            <Field label="Janela anti-duplicados (min)">
              <Input name="duplicateWindowMinutes" type="number" min={1} max={30} defaultValue={st.duplicateWindowMinutes ?? 2} />
            </Field>
            <Field label="Divisor do valor diário" hint="Pressuposto: 30. Confirmar com especialista.">
              <Input name="payrollDailyDivisor" type="number" min={20} max={31} defaultValue={st.payrollDailyDivisor ?? 30} />
            </Field>
          </CardContent>
        </Card>
        <div className="xl:col-span-2"><SubmitButton>Guardar definições</SubmitButton></div>
      </ActionForm>

    </div>
  );
}

/* ------------------------------ Utilizadores ------------------------------ */

type Member = {
  id: string;
  active: boolean;
  user_id: string;
  created_at: string;
  roles: { code: string; name: string } | null;
  users: { name: string; email: string; status: string; last_login_at: string | null } | null;
};

const ROLE_INFO: { code: string; description: string }[] = [
  { code: "owner", description: "Controlo total da empresa, incluindo definições e proprietários." },
  { code: "admin", description: "Gere a empresa, utilizadores, locais e políticas." },
  { code: "hr", description: "Colaboradores, assiduidade, justificações e preparação salarial." },
  { code: "finance", description: "Aprovação salarial, recibos e registo de pagamentos." },
  { code: "supervisor", description: "Vê e valida apenas a equipa dos departamentos que chefia." },
  { code: "employee", description: "Marca ponto, consulta histórico, justifica faltas e vê recibos." },
];

function UsersTab() {
  const { companyId, tz, me } = useCompany();
  const data = useData(async () => {
    const rows = must(
      await sb()
        .from("memberships")
        .select("id,active,user_id,created_at,roles(code,name),users(name,email,status,last_login_at)")
        .eq("company_id", companyId),
    ) as unknown as Member[];
    return rows.sort((a, b) => (a.users?.name ?? "").localeCompare(b.users?.name ?? ""));
  }, [companyId]);

  return (
    <div className="space-y-5">
      <Notice tone="info">
        O acesso de cada pessoa (utilizador, palavra-passe e papel) é atribuído na ficha do colaborador, em Colaboradores. Aqui vê quem tem acesso a esta empresa.
      </Notice>
      {data.error ? <ErrorBlock message={data.error} /> : null}
      {!data.data && !data.error ? <LoadingBlock rows={3} /> : null}
      {data.data ? (
        data.data.length === 0 ? (
          <EmptyState title="Sem utilizadores" />
        ) : (
          <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden">
            {data.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.users?.name ?? "?"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">
                    {m.users?.name ?? "—"}
                    {m.user_id === me.id ? <span className="ml-1.5 text-xs font-normal text-muted">(você)</span> : null}
                  </p>
                  <p className="truncate text-[12.5px] text-muted">{m.users?.email}</p>
                  <p className="text-[12.5px] text-muted">
                    Último acesso: {m.users?.last_login_at ? <span className="tabular">{formatDateTime(m.users.last_login_at, tz)}</span> : "nunca"}
                  </p>
                </div>
                <span className="flex flex-col items-end gap-1">
                  <Badge tone={m.roles?.code === "owner" || m.roles?.code === "admin" ? "primary" : "neutral"}>
                    {ROLE_LABEL[m.roles?.code ?? ""] ?? m.roles?.name ?? "—"}
                  </Badge>
                  {m.active && m.users?.status !== "disabled" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Desactivado</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <TableWrap className="hidden md:block">
            <Table>
              <THead>
                <tr><TH>Utilizador</TH><TH>Papel</TH><TH>Último acesso</TH><TH>Estado</TH></tr>
              </THead>
              <tbody>
                {data.data.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.users?.name ?? "?"} size={30} />
                        <span className="min-w-0">
                          <span className="block font-bold">
                            {m.users?.name ?? "—"}
                            {m.user_id === me.id ? <span className="ml-1.5 text-xs font-normal text-muted">(você)</span> : null}
                          </span>
                          <span className="block text-xs text-muted">{m.users?.email}</span>
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={m.roles?.code === "owner" || m.roles?.code === "admin" ? "primary" : "neutral"}>
                        {ROLE_LABEL[m.roles?.code ?? ""] ?? m.roles?.name ?? "—"}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{m.users?.last_login_at ? formatDateTime(m.users.last_login_at, tz) : "Nunca"}</TD>
                    <TD>
                      {m.active && m.users?.status !== "disabled" ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Desactivado</Badge>}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          </>
        )
      ) : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Papéis e permissões</CardTitle>
            <CardDescription>Princípio do privilégio mínimo. A separação de funções impede quem prepara salários de os aprovar.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-x-10 md:grid-cols-2">
            {ROLE_INFO.map((r, i) => (
              <li key={r.code} className="flex gap-3 border-t border-border py-3.5 md:[&:nth-child(-n+2)]:border-t-0 max-md:first:border-t-0">
                <span className={`stem mt-1.5 ${i < 2 ? "text-primary" : i < 4 ? "text-indigo" : "text-border-strong"}`} aria-hidden />
                <span>
                  <span className="block text-[14px] font-bold">{ROLE_LABEL[r.code]}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{r.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------ Organização ------------------------------ */

type Branch = { id: string; name: string; address: string | null; city: string | null };
type Department = { id: string; name: string; branch_id: string | null; manager_user_id: string | null };
type Manager = { id: string; name: string; role: string };

/** Remove uma linha com mensagem clara quando há registos associados. */
async function removeRow(table: "branches" | "departments", id: string) {
  const { error } = await sb().from(table).delete().eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23503") throw new Error("Não é possível remover: existem registos associados (colaboradores, locais ou departamentos).");
    throw new Error(errorMessage(error));
  }
}

function OrgTab() {
  const { companyId } = useCompany();
  const data = useData(async () => {
    const [b, d, m] = await Promise.all([
      sb().from("branches").select("id,name,address,city").eq("company_id", companyId).order("name"),
      sb().from("departments").select("id,name,branch_id,manager_user_id").eq("company_id", companyId).order("name"),
      sb().from("memberships").select("user_id,active,roles(code),users(id,name)").eq("company_id", companyId).eq("active", true),
    ]);
    const managers = ((must(m) ?? []) as unknown as { user_id: string; roles: { code: string } | null; users: { id: string; name: string } | null }[])
      .filter((x) => x.users)
      .map((x) => ({ id: x.user_id, name: x.users!.name, role: x.roles?.code ?? "" }))
      .sort((a, b2) => a.name.localeCompare(b2.name));
    return { branches: must(b) as Branch[], departments: must(d) as Department[], managers: managers as Manager[] };
  }, [companyId]);

  if (data.error) return <ErrorBlock message={data.error} />;
  if (!data.data) return <LoadingBlock rows={2} />;
  const { branches, departments, managers } = data.data;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Filiais</CardTitle>
          <BranchEditor onDone={data.reload} />
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <p className="text-[13px] text-muted">Sem filiais.</p>
          ) : (
            <ul className="divide-y divide-border">
              {branches.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 py-3 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="font-bold">{x.name}</span>
                    <span className="block text-xs text-muted">{[x.address, x.city].filter(Boolean).join(", ") || "—"}</span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <BranchEditor branch={x} onDone={data.reload} />
                    <DeleteButton label={`Remover a filial "${x.name}"?`} onDelete={() => removeRow("branches", x.id)} onDone={data.reload} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Departamentos</CardTitle>
            <CardDescription>O supervisor responsável vê e valida apenas a equipa do departamento.</CardDescription>
          </div>
          <DepartmentEditor branches={branches} managers={managers} onDone={data.reload} />
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="text-[13px] text-muted">Sem departamentos.</p>
          ) : (
            <ul className="divide-y divide-border">
              {departments.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="font-bold">{x.name}</span>
                    <span className="block text-xs text-muted">{branches.find((y) => y.id === x.branch_id)?.name ?? "Sem filial"}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Select
                      defaultValue={x.manager_user_id ?? ""}
                      className="h-9 w-48"
                      aria-label="Supervisor responsável"
                      onChange={async (e) => {
                        const v = e.currentTarget.value || null;
                        const { error } = await sb().from("departments").update({ manager_user_id: v }).eq("id", x.id);
                        if (error) toast.error(errorMessage(error));
                        else {
                          toast.success("Responsável actualizado.");
                          data.reload();
                        }
                      }}
                    >
                      <option value="">Sem supervisor</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${ROLE_LABEL[m.role] ?? m.role})` : ""}</option>
                      ))}
                    </Select>
                    <DepartmentEditor department={x} branches={branches} managers={managers} onDone={data.reload} />
                    <DeleteButton label={`Remover o departamento "${x.name}"?`} onDelete={() => removeRow("departments", x.id)} onDone={data.reload} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteButton({ label, onDelete, onDone }: { label: string; onDelete: () => Promise<void>; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="hover:text-danger"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(label)) return;
        setBusy(true);
        try {
          await onDelete();
          toast.success("Removido.");
          onDone();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao remover.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="spinner" aria-hidden /> : null}
      Remover
    </Button>
  );
}

function BranchEditor({ branch, onDone }: { branch?: Branch; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {branch ? (
          <Button size="sm" variant="ghost">Editar</Button>
        ) : (
          <Button size="sm" variant="soft">Nova filial</Button>
        )}
      </DialogTrigger>
      <DialogContent title={branch ? "Editar filial" : "Nova filial"}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              if (!o.name || o.name.length < 2) throw new Error("Indique o nome da filial.");
              const values = { name: o.name, city: o.city ?? null, address: o.address ?? null };
              if (branch) must(await sb().from("branches").update(values).eq("id", branch.id).select("id"));
              else must(await sb().from("branches").insert({ ...values, company_id: companyId }));
              onDone();
              return branch ? "Filial actualizada." : "Filial criada.";
            })
          }
          onSuccess={() => setOpen(false)}
          resetOnSuccess={!branch}
          className="space-y-4"
        >
          <Field label="Nome"><Input name="name" required defaultValue={branch?.name} /></Field>
          <Field label="Cidade"><Input name="city" defaultValue={branch?.city ?? ""} /></Field>
          <Field label="Morada"><Input name="address" defaultValue={branch?.address ?? ""} /></Field>
          <SubmitButton className="w-full">{branch ? "Guardar" : "Criar"}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentEditor({ department, branches, managers, onDone }: { department?: Department; branches: Branch[]; managers: Manager[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {department ? (
          <Button size="sm" variant="ghost">Editar</Button>
        ) : (
          <Button size="sm" variant="soft">Novo departamento</Button>
        )}
      </DialogTrigger>
      <DialogContent title={department ? "Editar departamento" : "Novo departamento"}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              if (!o.name || o.name.length < 2) throw new Error("Indique o nome do departamento.");
              const values = { name: o.name, branch_id: o.branchId ?? null, manager_user_id: o.managerUserId ?? null };
              if (department) must(await sb().from("departments").update(values).eq("id", department.id).select("id"));
              else must(await sb().from("departments").insert({ ...values, company_id: companyId }));
              onDone();
              return department ? "Departamento actualizado." : "Departamento criado.";
            })
          }
          onSuccess={() => setOpen(false)}
          resetOnSuccess={!department}
          className="space-y-4"
        >
          <Field label="Nome"><Input name="name" required defaultValue={department?.name} /></Field>
          <Field label="Filial">
            <Select name="branchId" defaultValue={department?.branch_id ?? ""}>
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Supervisor responsável">
            <Select name="managerUserId" defaultValue={department?.manager_user_id ?? ""}>
              <option value="">—</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <SubmitButton className="w-full">{department ? "Guardar" : "Criar"}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
