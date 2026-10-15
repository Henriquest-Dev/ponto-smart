"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NewEmployee } from "@/components/company/p1-new-employee";
import { cleanSearch, EMPLOYEE_STATUS, LoadingRows, useOrgOptions } from "@/components/company/p1-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { errorMessage, must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const PAGE = 15;
const COLUMNS = "id,full_name,employee_code,job_title,email,phone,hire_date,status,user_id,nuit,departments(name),branches(name)";

type Row = {
  id: string;
  full_name: string;
  employee_code: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  hire_date: string | null;
  status: "active" | "inactive" | "terminated";
  user_id: string | null;
  nuit: string | null;
  departments: { name: string } | null;
  branches: { name: string } | null;
};

type Access = { active: boolean; role: string; roleName: string };

export default function EmployeesPage() {
  const { companyId, can, company, tz } = useCompany();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [dep, setDep] = useState("");
  const [estado, setEstado] = useState("active");
  const [page, setPage] = useState(1);
  const org = useOrgOptions();

  // Pesquisa com pequeno atraso para não consultar a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(cleanSearch(q));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = (cols: string, opts?: { count?: "exact" }) => {
    let qb = sb().from("employees").select(cols, opts).eq("company_id", companyId);
    if (estado !== "todos") qb = qb.eq("status", estado);
    if (dep) qb = qb.eq("department_id", dep);
    if (term) qb = qb.or(`full_name.ilike.*${term}*,employee_code.ilike.*${term}*,email.ilike.*${term}*`);
    return qb.order("full_name");
  };

  const list = useData(async () => {
    const res = await query(COLUMNS, { count: "exact" }).range((page - 1) * PAGE, page * PAGE - 1);
    const rows = must(res) as unknown as Row[];
    const userIds = rows.map((r) => r.user_id).filter((x): x is string => !!x);
    const access = new Map<string, Access>();
    if (userIds.length) {
      const m = await sb().from("memberships").select("user_id,active,roles(code,name)").eq("company_id", companyId).in("user_id", userIds);
      for (const r of (m.data ?? []) as unknown as { user_id: string; active: boolean; roles: { code: string; name: string } | null }[]) {
        access.set(r.user_id, { active: r.active, role: r.roles?.code ?? "employee", roleName: r.roles?.name ?? "Colaborador" });
      }
    }
    return { rows, total: res.count ?? rows.length, access };
  }, [companyId, term, dep, estado, page]);

  const total = list.data?.total ?? 0;
  const pages = Math.ceil(total / PAGE);
  const team = company.role === "supervisor";

  async function exportXlsx() {
    try {
      const res = await query(COLUMNS).limit(5000);
      const rows = must(res) as unknown as Row[];
      const { buildWorkbook, downloadBlob } = await import("@/lib/excel");
      const blob = await buildWorkbook([
        {
          name: "Colaboradores",
          title: `${company.companyName} — colaboradores`,
          columns: [
            { header: "Nº", key: "code", width: 10 },
            { header: "Nome", key: "name", width: 32 },
            { header: "Função", key: "job", width: 22 },
            { header: "Departamento", key: "dep", width: 20 },
            { header: "Filial", key: "branch", width: 18 },
            { header: "Email", key: "email", width: 28 },
            { header: "Telefone", key: "phone", width: 16 },
            { header: "NUIT", key: "nuit", width: 14 },
            { header: "Admissão", key: "hire", width: 14 },
            { header: "Estado", key: "status", width: 12 },
            { header: "Acesso", key: "access", width: 12 },
          ],
          rows: rows.map((r) => ({
            code: r.employee_code,
            name: r.full_name,
            job: r.job_title,
            dep: r.departments?.name,
            branch: r.branches?.name,
            email: r.email,
            phone: r.phone,
            nuit: r.nuit,
            hire: r.hire_date,
            status: EMPLOYEE_STATUS[r.status]?.label,
            access: r.user_id ? "Sim" : "Não",
          })),
        },
      ]);
      downloadBlob(blob, `colaboradores-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (!can("employees.view")) {
    return (
      <>
        <PageHeader title="Colaboradores" />
        <PageBody>
          <Notice tone="warning">Sem permissão para consultar colaboradores.</Notice>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Colaboradores"
        description={list.data ? `${total} ${total === 1 ? "colaborador" : "colaboradores"}${team ? " da sua equipa" : ""}` : undefined}
        actions={
          <>
            {can("reports.export") ? (
              <Button variant="outline" onClick={exportXlsx}>
                Exportar Excel
              </Button>
            ) : null}
            {can("employees.manage") && org.data ? <NewEmployee org={org.data} onCreated={list.reload} /> : null}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 sm:max-w-xs">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar nome, número ou email" aria-label="Pesquisar" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select
              value={dep}
              onChange={(e) => {
                setDep(e.target.value);
                setPage(1);
              }}
              aria-label="Departamento"
              className="sm:w-48"
            >
              <option value="">Todos os departamentos</option>
              {org.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setPage(1);
              }}
              aria-label="Estado"
              className="sm:w-36"
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="terminated">Cessados</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
        </div>

        {list.error ? (
          <Notice tone="danger">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <LoadingRows rows={6} />
        ) : !list.data?.rows.length ? (
          <EmptyState title="Nenhum colaborador encontrado" description="Ajuste os filtros ou crie um novo colaborador." />
        ) : (
          <div className={list.loading ? "opacity-60 transition-opacity" : undefined}>
            <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background md:hidden">
              {list.data.rows.map((e) => (
                <li key={e.id}>
                  <Link href={`/empresa/colaboradores/ficha/?id=${e.id}`} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={e.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold">{e.full_name}</p>
                      <p className="truncate text-[12.5px] text-muted">
                        {[e.job_title, e.departments?.name ?? "Sem departamento"].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-[12px] font-bold text-muted tabular">{e.employee_code}</span>
                      {!e.user_id ? <Badge className="text-[11.5px]">Sem acesso</Badge> : null}
                    </span>
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
                    <TH>Acesso</TH>
                    <TH>Estado</TH>
                  </tr>
                </THead>
                <tbody>
                  {list.data.rows.map((e) => {
                    const acc = e.user_id ? list.data!.access.get(e.user_id) : undefined;
                    const st = EMPLOYEE_STATUS[e.status];
                    return (
                      <TR key={e.id}>
                        <TD>
                          <Link href={`/empresa/colaboradores/ficha/?id=${e.id}`} className="flex items-center gap-3">
                            <Avatar name={e.full_name} size={32} />
                            <span className="min-w-0">
                              <span className="block truncate text-[14px] font-bold">{e.full_name}</span>
                              <span className="block truncate text-[12.5px] text-muted">{e.job_title ?? "Sem função definida"}</span>
                            </span>
                          </Link>
                        </TD>
                        <TD className="font-bold text-muted tabular">{e.employee_code}</TD>
                        <TD>{e.departments?.name ?? "—"}</TD>
                        <TD className="text-muted">{e.branches?.name ?? "—"}</TD>
                        <TD className="text-muted tabular">{formatDate(e.hire_date, tz)}</TD>
                        <TD>
                          {!e.user_id ? (
                            <Badge>Sem acesso</Badge>
                          ) : acc && !acc.active ? (
                            <Badge tone="danger">Desactivado</Badge>
                          ) : (
                            <Badge tone="primary">{acc && acc.role !== "employee" ? acc.roleName : "Com acesso"}</Badge>
                          )}
                        </TD>
                        <TD>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={setPage} />
      </PageBody>
    </>
  );
}
