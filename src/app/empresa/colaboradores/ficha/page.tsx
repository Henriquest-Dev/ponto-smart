"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AccessDialog,
  AssignComponent,
  AssignSchedule,
  EditEmployee,
  NewSalary,
  type EmployeeRecord,
} from "@/components/company/p1-employee-forms";
import { CONTRACT_LABEL, EMPLOYEE_STATUS, LoadingRows, todayIn, useOrgOptions } from "@/components/company/p1-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, DescriptionList, EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { currentMonth, MonthPicker } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatDateTime, formatMinutes, formatMoney, formatTime } from "@/lib/format";
import { dailyStatus, ROLE_LABEL } from "@/lib/labels";
import type { DailyStatus } from "@/lib/domain/attendance-rules";
import { attempt } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { monthRange } from "@/lib/time";

type Employee = EmployeeRecord & { departments: { name: string } | null; branches: { name: string } | null };
type Account = { id: string; email: string; status: string; last_login_at: string | null } | null;
type Membership = { active: boolean; roles: { code: string; name: string } | null } | null;
type TabKey = "resumo" | "assiduidade" | "salario" | "dispositivos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EmployeeDetailPage() {
  const id = useQueryParam("id");
  const { companyId, can } = useCompany();
  const [tab, setTab] = useState<TabKey>("resumo");
  const org = useOrgOptions();
  const valid = !!id && UUID.test(id);

  const main = useData(async () => {
    if (!valid) return null;
    const e = must(
      await sb().from("employees").select("*,departments(name),branches(name)").eq("id", id).eq("company_id", companyId).maybeSingle(),
    ) as Employee | null;
    if (!e) return null;
    const [user, membership, contract] = await Promise.all([
      e.user_id ? sb().from("users").select("id,email,status,last_login_at").eq("id", e.user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      e.user_id
        ? sb().from("memberships").select("active,roles(code,name)").eq("user_id", e.user_id).eq("company_id", companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sb().from("employment_contracts").select("type,weekly_hours,start_date,end_date").eq("employee_id", e.id).order("start_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      e,
      account: (user.data ?? null) as Account,
      membership: (membership.data ?? null) as unknown as Membership,
      contract: (contract.data ?? null) as { type: string; weekly_hours: number } | null,
    };
  }, [id, companyId, valid]);

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/empresa/colaboradores/">Voltar à lista</Link>
    </Button>
  );

  if (!valid || (!main.loading && !main.error && !main.data)) {
    return (
      <>
        <PageHeader title="Colaborador" actions={back} />
        <PageBody>
          <EmptyState title="Colaborador não encontrado" description="O registo não existe ou não pertence à sua equipa." />
        </PageBody>
      </>
    );
  }
  if (main.error) {
    return (
      <>
        <PageHeader title="Colaborador" actions={back} />
        <PageBody>
          <Notice tone="danger">{main.error}</Notice>
        </PageBody>
      </>
    );
  }
  if (!main.data) {
    return (
      <>
        <div className="px-4 pt-6 pb-2 sm:px-6 lg:px-10 lg:pt-9">
          <Skeleton className="h-8 w-64 rounded-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full rounded-full" />
        </div>
        <PageBody>
          <LoadingRows rows={4} />
        </PageBody>
      </>
    );
  }

  const { e } = main.data;
  const canSalary = can("employees.salary.view");
  const canDevices = can("attendance.manage");
  const tabs: { key: TabKey; label: string }[] = [
    { key: "resumo", label: "Resumo" },
    { key: "assiduidade", label: "Assiduidade" },
    ...(canSalary ? [{ key: "salario" as const, label: "Salário e rubricas" }] : []),
    ...(canDevices ? [{ key: "dispositivos" as const, label: "Dispositivos" }] : []),
  ];

  return (
    <>
      <PageHeader
        title={e.full_name}
        description={[`Nº ${e.employee_code}`, e.job_title ?? "Sem função", e.departments?.name ?? "Sem departamento"].join(", ")}
        actions={
          <>
            {back}
            {can("employees.manage") && org.data ? <EditEmployee employee={e} org={org.data} onSaved={main.reload} /> : null}
          </>
        }
      />
      <PageBody>
        <Tabs items={tabs} active={tab} onChange={setTab} />
        {tab === "resumo" ? <Summary data={main.data} schedules={org.data?.schedules ?? []} reload={main.reload} /> : null}
        {tab === "assiduidade" ? <AttendanceTab employeeId={e.id} /> : null}
        {tab === "salario" && canSalary ? <SalaryTab employeeId={e.id} /> : null}
        {tab === "dispositivos" && canDevices ? <DevicesTab employeeId={e.id} /> : null}
      </PageBody>
    </>
  );
}

function Summary({
  data,
  schedules,
  reload,
}: {
  data: { e: Employee; account: Account; membership: Membership; contract: { type: string; weekly_hours: number } | null };
  schedules: { id: string; name: string }[];
  reload: () => void;
}) {
  const { can, tz, me } = useCompany();
  const { e, account, membership, contract } = data;
  const st = EMPLOYEE_STATUS[e.status];

  const shifts = useData(async () => {
    const res = await sb()
      .from("shift_assignments")
      .select("id,valid_from,valid_to,work_schedules(name)")
      .eq("employee_id", e.id)
      .order("valid_from", { ascending: false });
    return must(res) as unknown as { id: string; valid_from: string; valid_to: string | null; work_schedules: { name: string } | null }[];
  }, [e.id]);
  const today = todayIn(tz);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card className="p-5 sm:p-6">
        <div className="mb-6 flex items-center gap-4 border-b border-border pb-6">
          <Avatar name={e.full_name} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[20px] leading-tight font-extrabold tracking-[-0.02em]">{e.full_name}</p>
            <p className="mt-0.5 truncate text-[13.5px] text-muted">{e.email ?? "Sem email"}</p>
          </div>
          <Badge tone={st.tone} className="shrink-0 text-[13.5px]">
            {st.label}
          </Badge>
        </div>
        <DescriptionList
          items={[
            ["Nº mecanográfico", e.employee_code],
            ["Função", e.job_title ?? "—"],
            ["Departamento", e.departments?.name ?? "—"],
            ["Filial", e.branches?.name ?? "—"],
            ["Telefone", e.phone ?? "—"],
            ["NUIT", e.nuit ?? "—"],
            ["Admissão", formatDate(e.hire_date, tz)],
            ["Contrato", contract ? `${CONTRACT_LABEL[contract.type] ?? contract.type}, ${contract.weekly_hours} h por semana` : "—"],
            ["Conta bancária", e.bank_account ?? "—"],
          ]}
        />
      </Card>

      <div className="space-y-6">
        <AccessCard employee={e} account={account} membership={membership} isSelf={account?.id === me.id} reload={reload} />

        <Card>
          <CardHeader>
            <CardTitle>Horário</CardTitle>
            {can("schedules.manage", "employees.manage") ? <AssignSchedule employeeId={e.id} schedules={schedules} onDone={shifts.reload} /> : null}
          </CardHeader>
          <CardContent>
            {shifts.error ? (
              <Notice tone="danger">{shifts.error}</Notice>
            ) : !shifts.data ? (
              <Skeleton className="h-10 w-full rounded-[14px]" />
            ) : shifts.data.length ? (
              <ul className="space-y-4">
                {shifts.data.map((s) => {
                  const current = s.valid_from <= today && (!s.valid_to || s.valid_to >= today);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-[14px] font-bold">{s.work_schedules?.name ?? "Horário"}</span>
                        <span className="block text-[12.5px] text-muted">
                          Desde {formatDate(s.valid_from, tz)}
                          {s.valid_to ? ` até ${formatDate(s.valid_to, tz)}` : ""}
                        </span>
                      </span>
                      {current ? <Badge tone="success">Vigente</Badge> : s.valid_from > today ? <Badge tone="info">Futuro</Badge> : <Badge>Histórico</Badge>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Sem horário atribuído, as faltas não são calculadas.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AccessCard({
  employee: e,
  account,
  membership,
  isSelf,
  reload,
}: {
  employee: Employee;
  account: Account;
  membership: Membership;
  isSelf: boolean;
  reload: () => void;
}) {
  const { can, tz } = useCompany();
  const manage = can("employees.manage");
  const role = membership?.roles?.code ?? "employee";
  const roleName = membership?.roles?.name ?? ROLE_LABEL[role] ?? role;
  const active = !!account && !!membership?.active;
  // Repor a palavra-passe reenvia o papel actual; papéis acima de colaborador exigem quem gere contas.
  const canTouchRole = role === "employee" || can("users.manage");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Acesso ao Horbit</CardTitle>
          <CardDescription>Credenciais criadas pela empresa para o colaborador entrar.</CardDescription>
        </div>
        {account ? active ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Desactivado</Badge> : <Badge>Sem acesso</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        {account ? (
          <DescriptionList
            items={[
              ["Utilizador", <span key="l" className="font-mono break-all">{account.email}</span>],
              ["Papel", roleName],
              ["Último acesso", account.last_login_at ? formatDateTime(account.last_login_at, tz) : "Nunca entrou"],
            ]}
          />
        ) : (
          <p className="text-[13px] text-muted">
            Este colaborador ainda não tem utilizador. Crie-o para que possa marcar ponto e consultar o histórico e os recibos.
          </p>
        )}

        {manage ? (
          !account ? (
            <AccessDialog mode="create" employee={e} currentLogin={null} currentRole="employee" onDone={reload} />
          ) : !canTouchRole ? (
            <Notice tone="info">Este utilizador tem o papel {roleName}. Só quem gere contas pode alterar o acesso.</Notice>
          ) : (
            <div className="flex flex-wrap gap-2">
              {active ? (
                <>
                  <AccessDialog mode="reset" employee={e} currentLogin={account.email} currentRole={role} onDone={reload} />
                  <AccessDialog mode="edit" employee={e} currentLogin={account.email} currentRole={role} onDone={reload} />
                  {!isSelf ? (
                    <ActionButton
                      size="sm"
                      variant="danger-outline"
                      confirm={`Remover o acesso de ${e.full_name}? Deixa de conseguir entrar no Horbit.`}
                      action={() =>
                        attempt(async () => {
                          await rpc("ps_remove_access", { p_employee: e.id });
                          reload();
                          return "Acesso removido.";
                        })
                      }
                    >
                      Remover acesso
                    </ActionButton>
                  ) : null}
                </>
              ) : e.status === "active" ? (
                <AccessDialog mode="reactivate" employee={e} currentLogin={account.email} currentRole={role} onDone={reload} />
              ) : (
                <p className="text-[13px] text-muted">O acesso está bloqueado porque o colaborador não está activo.</p>
              )}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

type DayRow = {
  id: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  overtime_minutes: number;
  late_minutes: number;
  status: DailyStatus;
};

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const { tz } = useCompany();
  const current = currentMonth(tz);
  const [month, setMonth] = useState(current);
  const days = useData(async () => {
    const [y, m] = month.split("-").map(Number);
    const r = monthRange(y, m);
    const res = await sb()
      .from("attendance_daily")
      .select("id,work_date,first_in,last_out,worked_minutes,overtime_minutes,late_minutes,status")
      .eq("employee_id", employeeId)
      .gte("work_date", r.from)
      .lte("work_date", r.to)
      .order("work_date", { ascending: false });
    return must(res) as DayRow[];
  }, [employeeId, month]);

  const list = days.data ?? [];
  const s = {
    workedDays: list.filter((d) => d.first_in).length,
    workedMinutes: list.reduce((a, d) => a + d.worked_minutes, 0),
    overtime: list.reduce((a, d) => a + d.overtime_minutes, 0),
    late: list.filter((d) => d.status === "late").length,
    absences: list.filter((d) => ["absent_pending", "unjustified", "justified"].includes(d.status)).length,
    justified: list.filter((d) => d.status === "justified").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <MonthPicker value={month} onChange={setMonth} max={current} />
      </div>
      {days.error ? (
        <Notice tone="danger">{days.error}</Notice>
      ) : days.loading && !days.data ? (
        <LoadingRows rows={5} />
      ) : (
        <>
          <StatRow>
            <Stat label="Dias trabalhados" value={s.workedDays} />
            <Stat label="Horas" value={formatMinutes(s.workedMinutes)} hint={`${formatMinutes(s.overtime)} extra`} />
            <Stat label="Atrasos" value={s.late} />
            <Stat label="Faltas" value={s.absences} hint={`${s.justified} justificadas`} />
          </StatRow>
          {list.length ? (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background md:hidden">
                {list.map((d) => {
                  const st = dailyStatus(d.status);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold tabular">{formatDate(d.work_date, tz)}</p>
                        <p className="text-[12.5px] text-muted tabular">
                          {d.first_in ? `${formatTime(d.first_in, tz)}–${d.last_out ? formatTime(d.last_out, tz) : "sem saída"}` : "Sem marcações"}
                          {d.worked_minutes ? `, ${formatMinutes(d.worked_minutes)}` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </li>
                  );
                })}
              </ul>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <tr>
                      <TH>Data</TH>
                      <TH>Entrada</TH>
                      <TH>Saída</TH>
                      <TH>Trabalhado</TH>
                      <TH>Atraso</TH>
                      <TH>Estado</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {list.map((d) => {
                      const st = dailyStatus(d.status);
                      return (
                        <TR key={d.id}>
                          <TD className="font-bold tabular">{formatDate(d.work_date, tz)}</TD>
                          <TD className="tabular">{formatTime(d.first_in, tz)}</TD>
                          <TD className="tabular">{formatTime(d.last_out, tz)}</TD>
                          <TD className="font-bold tabular">{formatMinutes(d.worked_minutes)}</TD>
                          <TD className="tabular">{d.late_minutes ? <span className="font-bold text-warning">{d.late_minutes} min</span> : <span className="text-subtle">—</span>}</TD>
                          <TD>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            </>
          ) : (
            <EmptyState title="Sem registos neste mês" />
          )}
        </>
      )}
    </div>
  );
}

function SalaryTab({ employeeId }: { employeeId: string }) {
  const { can, tz, companyId, company } = useCompany();
  const today = todayIn(tz);
  const canManage = can("employees.manage");
  const canComponents = can("payroll.view") && can("employees.salary.view");

  const data = useData(async () => {
    const [agreements, comps, catalog] = await Promise.all([
      sb().from("salary_agreements").select("id,amount,currency,effective_from,effective_to").eq("employee_id", employeeId).order("effective_from", { ascending: false }),
      sb()
        .from("employee_components")
        .select("id,amount,effective_from,effective_to,note,payroll_components(name,nature)")
        .eq("employee_id", employeeId)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false }),
      canComponents
        ? sb().from("payroll_components").select("id,name,nature,calc_type").eq("company_id", companyId).eq("active", true).neq("calc_type", "per_hour").order("name")
        : Promise.resolve({ data: [], error: null }),
    ]);
    return {
      agreements: must(agreements) as { id: string; amount: string; currency: string; effective_from: string; effective_to: string | null }[],
      comps: must(comps) as unknown as {
        id: string;
        amount: string;
        effective_from: string;
        effective_to: string | null;
        note: string | null;
        payroll_components: { name: string; nature: string } | null;
      }[],
      catalog: (catalog.data ?? []) as { id: string; name: string; nature: string }[],
    };
  }, [employeeId, today, canComponents, companyId]);

  if (data.error) return <Notice tone="danger">{data.error}</Notice>;
  if (!data.data) return <LoadingRows rows={3} />;
  const { agreements, comps, catalog } = data.data;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Histórico salarial</CardTitle>
          {canManage ? <NewSalary employeeId={employeeId} onDone={data.reload} /> : null}
        </CardHeader>
        <CardContent>
          {agreements.length ? (
            <ul className="divide-y divide-border">
              {agreements.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <span className="inline-flex items-center gap-2 text-[13px] text-muted">
                    {!a.effective_to ? <span className="stem text-primary" aria-hidden /> : null}
                    <span className={a.effective_to ? "tabular" : "font-bold text-foreground tabular"}>
                      {formatDate(a.effective_from, tz)} {a.effective_to ? `a ${formatDate(a.effective_to, tz)}` : "até hoje"}
                    </span>
                  </span>
                  <span className={a.effective_to ? "text-[14px] font-bold text-muted tabular" : "text-[18px] font-extrabold tracking-[-0.01em] tabular"}>{formatMoney(a.amount, a.currency || company.currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Sem acordo salarial registado.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Rubricas atribuídas</CardTitle>
          {canComponents ? <AssignComponent employeeId={employeeId} components={catalog} onDone={data.reload} /> : null}
        </CardHeader>
        <CardContent>
          {comps.length ? (
            <ul className="divide-y divide-border">
              {comps.map((ec) => {
                const deduction = ec.payroll_components?.nature === "deduction";
                return (
                  <li key={ec.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold">{ec.payroll_components?.name ?? "Rubrica"}</span>
                      <span className="block text-[12.5px] text-muted">
                        {deduction ? "Desconto" : "Abono"}, desde {formatDate(ec.effective_from, tz)}
                        {ec.effective_to ? ` até ${formatDate(ec.effective_to, tz)}` : ""}
                      </span>
                      {ec.note ? <span className="block text-[12.5px] text-subtle">{ec.note}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`text-[15px] font-extrabold tabular ${deduction ? "text-danger" : ""}`}>
                        {deduction ? "−" : ""}
                        {formatMoney(ec.amount, company.currency)}
                      </span>
                      {canComponents ? (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          confirm="Terminar esta rubrica hoje?"
                          action={() =>
                            attempt(async () => {
                              must(await sb().from("employee_components").update({ effective_to: today }).eq("id", ec.id));
                              data.reload();
                              return "Rubrica terminada.";
                            })
                          }
                        >
                          Terminar
                        </ActionButton>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Sem rubricas vigentes.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DevicesTab({ employeeId }: { employeeId: string }) {
  const { tz, can } = useCompany();
  const list = useData(async () => {
    const res = await sb()
      .from("trusted_devices")
      .select("id,label,created_at,last_used_at,revoked_at")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    return must(res) as { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  }, [employeeId]);

  if (list.error) return <Notice tone="danger">{list.error}</Notice>;
  if (!list.data) return <LoadingRows rows={2} />;
  if (!list.data.length)
    return <EmptyState title="Sem dispositivos registados" description="O colaborador pode registar o telemóvel em Perfil, na aplicação." />;

  const revoke = (id: string) =>
    attempt(async () => {
      await rpc("ps_revoke_device", { p_device: id });
      list.reload();
      return "Dispositivo revogado.";
    });

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background md:hidden">
        {list.data.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold">{d.label}</p>
              <p className="text-[12.5px] text-muted">Última marcação: {d.last_used_at ? formatDateTime(d.last_used_at, tz) : "nenhuma"}</p>
            </div>
            {d.revoked_at ? (
              <Badge tone="danger">Revogado</Badge>
            ) : can("attendance.manage") ? (
              <ActionButton size="sm" variant="ghost" confirm="Revogar este dispositivo?" action={() => revoke(d.id)}>
                Revogar
              </ActionButton>
            ) : (
              <Badge tone="success">Activo</Badge>
            )}
          </li>
        ))}
      </ul>
      <TableWrap className="hidden md:block">
        <Table>
          <THead>
            <tr>
              <TH>Dispositivo</TH>
              <TH>Registado</TH>
              <TH>Última marcação</TH>
              <TH>Estado</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {list.data.map((d) => (
              <TR key={d.id}>
                <TD className="text-[14px] font-bold">{d.label}</TD>
                <TD className="text-muted">{formatDate(d.created_at, tz)}</TD>
                <TD className="text-muted">{d.last_used_at ? formatDateTime(d.last_used_at, tz) : "—"}</TD>
                <TD>{d.revoked_at ? <Badge tone="danger">Revogado</Badge> : <Badge tone="success">Activo</Badge>}</TD>
                <TD className="text-right">
                  {!d.revoked_at && can("attendance.manage") ? (
                    <ActionButton size="sm" variant="ghost" confirm="Revogar este dispositivo?" action={() => revoke(d.id)}>
                      Revogar
                    </ActionButton>
                  ) : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
