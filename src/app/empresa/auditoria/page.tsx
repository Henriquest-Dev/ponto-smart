"use client";

import * as React from "react";
import { ErrorBlock, NoAccess } from "@/components/company/p2-shared";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const PAGE = 30;

const ENTITIES: Record<string, string> = {
  attendance_event: "Marcações",
  attendance_daily: "Dias de assiduidade",
  absence_request: "Justificações",
  employee: "Colaboradores",
  employees: "Colaboradores (ficha)",
  salary_agreements: "Acordos salariais",
  employee_components: "Rubricas do colaborador",
  payroll_components: "Rubricas",
  payroll_period: "Períodos salariais",
  payroll_run: "Processamentos",
  salary_payment: "Pagamentos",
  work_locations: "Locais",
  attendance_stations: "Estações",
  work_schedules: "Horários",
  holidays: "Feriados",
  shift_assignments: "Atribuição de horários",
  branches: "Filiais",
  departments: "Departamentos",
  companies: "Empresa",
};

type Row = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
  users: { name: string } | null;
};

export default function AuditPage() {
  const { can } = useCompany();
  if (!can("audit.view")) return <NoAccess title="Auditoria" />;
  return <Audit />;
}

function Audit() {
  const { companyId, tz } = useCompany();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState({ q: "", entity: "" });
  const [page, setPage] = React.useState(1);

  const data = useData(async () => {
    let query = sb()
      .from("audit_logs")
      .select("id,actor_id,action,entity,entity_id,before,after,ip,created_at,users(name)", { count: "exact" })
      .eq("company_id", companyId);
    if (filter.q) query = query.ilike("action", `%${filter.q.replace(/[%_]/g, "")}%`);
    if (filter.entity) query = query.eq("entity", filter.entity);
    const res = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    return { rows: must(res) as unknown as Row[], total: res.count ?? 0 };
  }, [companyId, filter.q, filter.entity, page]);

  return (
    <>
      <PageHeader title="Auditoria" description="Trilho imutável de acções: quem, o quê e quando." />
      <PageBody>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilter((f) => ({ ...f, q: q.trim() }));
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por acção (ex.: payroll, absence, employees)" className="sm:max-w-sm" />
          <Select
            value={filter.entity}
            onChange={(e) => {
              setPage(1);
              setFilter((f) => ({ ...f, entity: e.target.value }));
            }}
            className="sm:w-56"
            aria-label="Entidade"
          >
            <option value="">Todas as entidades</option>
            {Object.entries(ENTITIES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Button type="submit" variant="soft">Filtrar</Button>
        </form>

        {data.error ? <ErrorBlock message={data.error} /> : null}
        {data.loading && !data.data ? <Skeleton className="h-96 w-full rounded-[22px]" /> : null}
        {data.data && data.data.rows.length === 0 ? <EmptyState title="Sem registos" description="Nenhuma acção corresponde aos filtros escolhidos." /> : null}
        {data.data && data.data.rows.length > 0 ? (
          <TableWrap className={data.loading ? "opacity-60" : undefined}>
            <Table>
              <THead>
                <tr><TH>Quando</TH><TH>Utilizador</TH><TH>Acção</TH><TH>Entidade</TH><TH>Detalhe</TH></tr>
              </THead>
              <tbody>
                {data.data.rows.map((a) => (
                  <TR key={a.id} className="align-top">
                    <TD className="whitespace-nowrap text-muted tabular">{formatDateTime(a.created_at, tz)}</TD>
                    <TD className="whitespace-nowrap font-bold">{a.users?.name ?? (a.actor_id ? "Utilizador" : "Sistema")}</TD>
                    <TD><span className="inline-flex items-center gap-2 font-mono text-xs"><span className={`stem h-3 ${actionTone(a.action)}`} aria-hidden />{a.action}</span></TD>
                    <TD className="text-xs text-muted">
                      {ENTITIES[a.entity] ?? a.entity}
                      {a.entity_id ? <span className="block font-mono text-[11px] text-subtle">{a.entity_id.slice(0, 8)}</span> : null}
                    </TD>
                    <TD className="max-w-md">
                      <Detail before={a.before} after={a.after} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : null}
        {data.data ? <Pagination page={page} pages={Math.ceil(data.data.total / PAGE)} onChange={setPage} /> : null}
      </PageBody>
    </>
  );
}

/** Cor da haste conforme o tipo de acção (criação, remoção, restante). */
function actionTone(action: string) {
  const a = action.toLowerCase();
  if (/(delete|remove|revoke|reject)/.test(a)) return "text-danger";
  if (/(insert|create|approve|issue)/.test(a)) return "text-success";
  return "text-primary";
}

/** Resumo das alterações: em actualizações mostra só os campos que mudaram. */
function Detail({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return <span className="text-muted">—</span>;
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  let shown: Record<string, unknown> = a;
  if (before && after) {
    shown = {};
    for (const k of Object.keys(a)) {
      if (k === "updated_at") continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) shown[k] = a[k];
    }
  } else if (!after) shown = b;
  const text = JSON.stringify(shown);
  if (text === "{}") return <span className="text-muted">Sem alterações relevantes</span>;
  return (
    <details>
      <summary className="cursor-pointer truncate font-mono text-[11px] text-muted [&::-webkit-details-marker]:hidden">{text}</summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-[14px] bg-surface p-3 font-mono text-[11px] whitespace-pre-wrap break-all">
        {JSON.stringify(shown, null, 2)}
      </pre>
    </details>
  );
}
