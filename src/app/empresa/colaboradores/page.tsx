import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { Download, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { branches, departments, employees } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { orgOptions } from "@/lib/queries/org";
import { teamFilter } from "@/lib/queries/scope";
import { NewEmployee } from "./new-employee";

export const metadata: Metadata = { title: "Colaboradores" };
const PAGE = 15;
const STATUS = { active: { label: "Activo", tone: "success" }, inactive: { label: "Inactivo", tone: "neutral" }, terminated: { label: "Cessado", tone: "danger" } } as const;

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; dep?: string; estado?: string; p?: string }> }) {
  const ctx = await requireCompany("employees.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const status = sp.estado === "todos" ? undefined : ((sp.estado as "active" | "inactive" | "terminated") ?? "active");
  const where = and(
    eq(employees.companyId, ctx.company.id),
    teamFilter(ctx),
    status ? eq(employees.status, status) : undefined,
    sp.dep ? eq(employees.departmentId, sp.dep) : undefined,
    sp.q ? or(ilike(employees.fullName, `%${sp.q}%`), ilike(employees.employeeCode, `%${sp.q}%`), ilike(employees.email, `%${sp.q}%`)) : undefined,
  );
  const [rows, [{ total }], org] = await Promise.all([
    db
      .select({ e: employees, department: departments.name, branch: branches.name })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(branches, eq(branches.id, employees.branchId))
      .where(where)
      .orderBy(asc(employees.fullName))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: count() }).from(employees).where(where),
    orgOptions(ctx.company.id),
  ]);
  const pages = Math.ceil(total / PAGE);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    if (sp.dep) u.set("dep", sp.dep);
    if (sp.estado) u.set("estado", sp.estado);
    u.set("p", String(p));
    return `/empresa/colaboradores?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Colaboradores"
        description={`${total} ${total === 1 ? "colaborador" : "colaboradores"}${ctx.teamDepartmentIds ? " da sua equipa" : ""}`}
        actions={
          <>
            {can(ctx, "reports.export") ? (
              <Button variant="outline" asChild>
                <a href="/api/reports/employees">
                  <Download /> Exportar
                </a>
              </Button>
            ) : null}
            {can(ctx, "employees.manage") ? <NewEmployee org={org} canSetSalary={can(ctx, "employees.salary.view")} /> : null}
          </>
        }
      />
      <PageBody>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input name="q" defaultValue={sp.q} placeholder="Nome, número ou email" className="pl-9" aria-label="Pesquisar" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select name="dep" defaultValue={sp.dep ?? ""} aria-label="Departamento" className="sm:w-48">
              <option value="">Todos os departamentos</option>
              {org.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select name="estado" defaultValue={sp.estado ?? "active"} aria-label="Estado" className="sm:w-36">
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="terminated">Cessados</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
          <Button type="submit" variant="soft">Filtrar</Button>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title="Nenhum colaborador encontrado" description="Ajuste os filtros ou crie um novo colaborador." />
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border md:hidden">
              {rows.map(({ e, department }) => (
                <li key={e.id}>
                  <Link href={`/empresa/colaboradores/${e.id}`} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={e.fullName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{e.fullName}</p>
                      <p className="truncate text-xs text-muted">{e.jobTitle ?? "—"} · {department ?? "Sem departamento"}</p>
                    </div>
                    <span className="text-xs text-subtle tabular">{e.employeeCode}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Colaborador</TH>
                    <TH>Nº</TH>
                    <TH>Departamento</TH>
                    <TH>Filial</TH>
                    <TH>Admissão</TH>
                    <TH>Conta</TH>
                    <TH>Estado</TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.map(({ e, department, branch }) => (
                    <TR key={e.id}>
                      <TD>
                        <Link href={`/empresa/colaboradores/${e.id}`} className="flex items-center gap-3">
                          <Avatar name={e.fullName} size={32} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{e.fullName}</span>
                            <span className="block truncate text-xs text-muted">{e.jobTitle ?? "—"}</span>
                          </span>
                        </Link>
                      </TD>
                      <TD className="text-muted tabular">{e.employeeCode}</TD>
                      <TD>{department ?? "—"}</TD>
                      <TD className="text-muted">{branch ?? "—"}</TD>
                      <TD className="text-muted tabular">{formatDate(e.hireDate)}</TD>
                      <TD>{e.userId ? <Badge tone="primary">Com acesso</Badge> : <Badge>Sem conta</Badge>}</TD>
                      <TD>
                        <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </>
        )}
        <Pagination page={page} pages={pages} hrefFor={qs} />
      </PageBody>
    </>
  );
}
