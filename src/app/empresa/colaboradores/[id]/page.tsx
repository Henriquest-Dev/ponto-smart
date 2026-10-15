import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, DescriptionList, EmptyState } from "@/components/ui/misc";
import { MonthPicker } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import {
  branches, departments, employeeComponents, employees, employmentContracts, payrollComponents, salaryAgreements,
  shiftAssignments, trustedDevices, users, workSchedules,
} from "@/lib/db/schema";
import { formatDate, formatDateTime, formatMinutes, formatMoney, formatTime } from "@/lib/format";
import { dailyStatus } from "@/lib/labels";
import { monthDays, summarize } from "@/lib/queries/employee";
import { orgOptions } from "@/lib/queries/org";
import { localDate } from "@/lib/time";
import { AssignComponent, AssignSchedule, EditEmployee, EndComponent, NewSalary, RevokeEmployeeDevice } from "./forms";

export const metadata: Metadata = { title: "Colaborador" };

const CONTRACT: Record<string, string> = { indeterminado: "Prazo indeterminado", determinado: "Prazo determinado", estagio: "Estágio", prestacao_servicos: "Prestação de serviços" };

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; mes?: string }> }) {
  const ctx = await requireCompany("employees.view");
  const { id } = await params;
  const sp = await searchParams;
  const tz = ctx.company.timezone;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db
    .select({ e: employees, department: departments.name, branch: branches.name, login: users.email, lastLogin: users.lastLoginAt })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(users, eq(users.id, employees.userId))
    .where(and(eq(employees.id, id), eq(employees.companyId, ctx.company.id)))
    .limit(1);
  if (!row) notFound();
  // Supervisores: apenas a equipa autorizada.
  if (ctx.teamDepartmentIds && (!row.e.departmentId || !ctx.teamDepartmentIds.includes(row.e.departmentId))) notFound();

  const e = row.e;
  const canSalary = can(ctx, "employees.salary.view");
  const tabs = [
    { key: "resumo", label: "Resumo", href: `?tab=resumo` },
    { key: "assiduidade", label: "Assiduidade", href: `?tab=assiduidade` },
    ...(canSalary ? [{ key: "salario", label: "Salário e rubricas", href: `?tab=salario` }] : []),
    { key: "dispositivos", label: "Dispositivos", href: `?tab=dispositivos` },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "resumo";
  const today = localDate(new Date(), tz);

  return (
    <>
      <PageHeader
        title={e.fullName}
        description={`${e.employeeCode} · ${e.jobTitle ?? "Sem função"} · ${row.department ?? "Sem departamento"}`}
        actions={can(ctx, "employees.manage") ? <EditEmployee employee={e} org={await orgOptions(ctx.company.id)} /> : null}
      />
      <PageBody>
        <LinkTabs items={tabs} active={tab} />

        {tab === "resumo" ? <Summary /> : null}
        {tab === "assiduidade" ? <Attendance /> : null}
        {tab === "salario" && canSalary ? <Salary /> : null}
        {tab === "dispositivos" ? <Devices /> : null}
      </PageBody>
    </>
  );

  async function Summary() {
    const [contract] = await db.select().from(employmentContracts).where(eq(employmentContracts.employeeId, e.id)).orderBy(desc(employmentContracts.startDate)).limit(1);
    const shifts = await db
      .select({ a: shiftAssignments, name: workSchedules.name })
      .from(shiftAssignments)
      .innerJoin(workSchedules, eq(workSchedules.id, shiftAssignments.scheduleId))
      .where(eq(shiftAssignments.employeeId, e.id))
      .orderBy(desc(shiftAssignments.validFrom));
    const org = await orgOptions(ctx.company.id);
    return (
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={e.fullName} size={52} />
            <div>
              <p className="text-[17px] font-semibold">{e.fullName}</p>
              <p className="text-[13px] text-muted">{e.email ?? "Sem email"}</p>
            </div>
            <Badge tone={e.status === "active" ? "success" : "neutral"} className="ml-auto">{e.status === "active" ? "Activo" : e.status === "inactive" ? "Inactivo" : "Cessado"}</Badge>
          </div>
          <DescriptionList
            items={[
              ["Departamento", row.department ?? "—"],
              ["Filial", row.branch ?? "—"],
              ["Telefone", e.phone ?? "—"],
              ["NUIT", e.nuit ?? "—"],
              ["Admissão", formatDate(e.hireDate, tz)],
              ["Contrato", contract ? `${CONTRACT[contract.type]} · ${contract.weeklyHours}h/semana` : "—"],
              ["Conta de acesso", row.login ?? "Sem conta"],
              ["Último acesso", row.lastLogin ? formatDateTime(row.lastLogin, tz) : "—"],
            ]}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Horário</CardTitle>
            {can(ctx, "schedules.manage") ? <AssignSchedule employeeId={e.id} schedules={org.schedules} /> : null}
          </CardHeader>
          <CardContent>
            {shifts.length ? (
              <ul className="space-y-3">
                {shifts.map((s) => {
                  const current = s.a.validFrom <= today && (!s.a.validTo || s.a.validTo >= today);
                  return (
                    <li key={s.a.id} className="flex items-center justify-between gap-3 text-[13px]">
                      <span>
                        <span className="font-medium">{s.name}</span>
                        <span className="block text-xs text-muted">
                          desde {formatDate(s.a.validFrom, tz)}{s.a.validTo ? ` até ${formatDate(s.a.validTo, tz)}` : ""}
                        </span>
                      </span>
                      {current ? <Badge tone="success">Vigente</Badge> : <Badge>Histórico</Badge>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Sem horário atribuído — as faltas não são calculadas.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  async function Attendance() {
    const current = today.slice(0, 7);
    const month = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : current;
    const [y, m] = month.split("-").map(Number);
    const days = await monthDays(ctx.company.id, e.id, y, m);
    const s = summarize(days);
    return (
      <div className="space-y-5">
        <div className="flex justify-end">
          <MonthPicker value={month} max={current} hrefFor={(v) => `?tab=assiduidade&mes=${v}`} />
        </div>
        <StatRow>
          <Stat label="Dias trabalhados" value={s.workedDays} />
          <Stat label="Horas" value={formatMinutes(s.workedMinutes)} hint={`${formatMinutes(s.overtimeMinutes)} extra`} />
          <Stat label="Atrasos" value={s.late} />
          <Stat label="Faltas" value={s.absences} hint={`${s.justified} justificadas`} />
        </StatRow>
        {days.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr><TH>Data</TH><TH>Entrada</TH><TH>Saída</TH><TH>Trabalhado</TH><TH>Atraso</TH><TH>Estado</TH></tr>
              </THead>
              <tbody>
                {days.map((d) => {
                  const st = dailyStatus(d.status);
                  return (
                    <TR key={d.id}>
                      <TD className="tabular">{formatDate(d.workDate, tz)}</TD>
                      <TD className="tabular">{formatTime(d.firstIn, tz)}</TD>
                      <TD className="tabular">{formatTime(d.lastOut, tz)}</TD>
                      <TD className="tabular">{formatMinutes(d.workedMinutes)}</TD>
                      <TD className="tabular text-muted">{d.lateMinutes ? `${d.lateMinutes} min` : "—"}</TD>
                      <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Sem registos neste mês" />
        )}
      </div>
    );
  }

  async function Salary() {
    const agreements = await db.select().from(salaryAgreements).where(eq(salaryAgreements.employeeId, e.id)).orderBy(desc(salaryAgreements.effectiveFrom));
    const comps = await db
      .select({ ec: employeeComponents, c: payrollComponents })
      .from(employeeComponents)
      .innerJoin(payrollComponents, eq(payrollComponents.id, employeeComponents.componentId))
      .where(and(eq(employeeComponents.employeeId, e.id), or(isNull(employeeComponents.effectiveTo), gte(employeeComponents.effectiveTo, today))))
      .orderBy(desc(employeeComponents.effectiveFrom));
    const catalog = await db.select().from(payrollComponents).where(and(eq(payrollComponents.companyId, ctx.company.id), eq(payrollComponents.active, true)));
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Histórico salarial</CardTitle>
            <NewSalary employeeId={e.id} />
          </CardHeader>
          <CardContent>
            {agreements.length ? (
              <ul className="divide-y divide-border">
                {agreements.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3 text-[13px]">
                    <span className="text-muted">
                      {formatDate(a.effectiveFrom, tz)} {a.effectiveTo ? `– ${formatDate(a.effectiveTo, tz)}` : "– actual"}
                    </span>
                    <span className="font-semibold tabular">{formatMoney(a.amount, a.currency)}</span>
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
            {can(ctx, "payroll.prepare") ? <AssignComponent employeeId={e.id} components={catalog.filter((c) => c.calcType !== "per_hour").map((c) => ({ id: c.id, name: c.name, nature: c.nature, rate: c.rate }))} /> : null}
          </CardHeader>
          <CardContent>
            {comps.length ? (
              <ul className="divide-y divide-border">
                {comps.map(({ ec, c }) => (
                  <li key={ec.id} className="flex items-center justify-between gap-3 py-3 text-[13px]">
                    <span className="min-w-0">
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {c.nature === "earning" ? "Abono" : "Desconto"} · desde {formatDate(ec.effectiveFrom, tz)}
                        {ec.effectiveTo ? ` até ${formatDate(ec.effectiveTo, tz)}` : ""}
                        {ec.note ? ` · ${ec.note}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`font-semibold tabular ${c.nature === "deduction" ? "text-danger" : ""}`}>{c.nature === "deduction" ? "−" : ""}{formatMoney(ec.amount)}</span>
                      {can(ctx, "payroll.prepare") ? <EndComponent id={ec.id} employeeId={e.id} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Sem rubricas vigentes.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  async function Devices() {
    const list = await db.select().from(trustedDevices).where(eq(trustedDevices.employeeId, e.id)).orderBy(desc(trustedDevices.createdAt));
    return list.length ? (
      <TableWrap>
        <Table>
          <THead>
            <tr><TH>Dispositivo</TH><TH>Registado</TH><TH>Última marcação</TH><TH>Estado</TH><TH></TH></tr>
          </THead>
          <tbody>
            {list.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.label}</TD>
                <TD className="text-muted">{formatDate(d.createdAt, tz)}</TD>
                <TD className="text-muted">{d.lastUsedAt ? formatDateTime(d.lastUsedAt, tz) : "—"}</TD>
                <TD>{d.revokedAt ? <Badge tone="danger">Revogado</Badge> : <Badge tone="success">Activo</Badge>}</TD>
                <TD className="text-right">{!d.revokedAt && can(ctx, "employees.manage") ? <RevokeEmployeeDevice id={d.id} employeeId={e.id} /> : null}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    ) : (
      <EmptyState title="Sem dispositivos registados" description="O colaborador pode registar o telemóvel em Perfil, na aplicação." />
    );
  }
}
