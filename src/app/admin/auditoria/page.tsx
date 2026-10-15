"use client";

import { ScrollText, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { must, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";

const PAGE = 30;

type Row = {
  id: string;
  company_id: string | null;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
  companies: { name: string } | null;
  users: { name: string; email: string } | null;
};

const ACTION_LABEL: Record<string, string> = {
  "company.provisioned": "Empresa criada",
  "company.status_changed": "Estado da empresa alterado",
  "company_request.rejected": "Pedido de conta recusado",
  "user.password_reset": "Palavra-passe reposta",
  "employee.access_set": "Acesso de colaborador definido",
  "employee.access_removed": "Acesso de colaborador removido",
  "absence.created": "Justificação submetida",
  "absence.approved": "Justificação aprovada",
  "absence.rejected": "Justificação recusada",
  "absence.step_approved": "Justificação aprovada (etapa)",
  "attendance.adjusted": "Ponto ajustado",
  "attendance.reviewed": "Marcação revista",
  "payroll.attendance_closed": "Assiduidade fechada",
  "payroll.attendance_reopened": "Assiduidade reaberta",
  "payroll.run_prepared": "Processamento salarial preparado",
  "payroll.run_approved": "Processamento salarial aprovado",
  "payroll.payslips_issued": "Recibos emitidos",
  "payroll.payment_registered": "Pagamento registado",
};

function first<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function PlatformAuditPage() {
  const [page, setPage] = React.useState(1);
  const [company, setCompany] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [detail, setDetail] = React.useState<Row | null>(null);

  const companies = useData(async () => must(await sb().from("companies").select("id,name").order("name")) as { id: string; name: string }[], []);

  const { data, error, loading } = useData(async () => {
    let q = sb()
      .from("audit_logs")
      .select("id,company_id,actor_id,action,entity,entity_id,before,after,ip,created_at,companies(name),users(name,email)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    if (company === "platform") q = q.is("company_id", null);
    else if (company !== "all") q = q.eq("company_id", company);
    if (term) q = q.or(`action.ilike.%${term}%,entity.ilike.%${term}%`);
    const res = await q;
    const rows = must(res) as unknown as (Omit<Row, "companies" | "users"> & { companies: unknown; users: unknown })[];
    return {
      rows: rows.map((r) => ({ ...r, companies: first(r.companies as Row["companies"]), users: first(r.users as Row["users"]) })) as Row[],
      total: res.count ?? 0,
    };
  }, [page, company, term]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Auditoria" description="Trilho de acções em toda a plataforma: quem, o quê, em que empresa e quando." />
      <PageBody>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="flex flex-1 gap-2 sm:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              // Só caracteres seguros no filtro do PostgREST.
              setTerm(search.trim().replace(/[^\p{L}\p{N}._-]/gu, ""));
              setPage(1);
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Acção ou entidade (ex.: company, payroll)" className="pl-9" aria-label="Filtrar por acção" />
            </div>
            <Button type="submit" variant="soft">
              Filtrar
            </Button>
          </form>
          <Select
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(1);
            }}
            className="sm:w-64"
            aria-label="Empresa"
          >
            <option value="all">Todas as empresas</option>
            <option value="platform">Plataforma (sem empresa)</option>
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <EmptyState icon={<ScrollText />} title="Sem registos" description={term || company !== "all" ? "Nenhum registo corresponde aos filtros." : undefined} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="mb-2 text-xs text-muted">{formatNumber(data.total)} registos</p>

            <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
              {data.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setDetail(r)} className="w-full px-4 py-3 text-left hover:bg-surface/60">
                    <p className="text-[13px] font-medium">{ACTION_LABEL[r.action] ?? r.action}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {r.companies?.name ?? "Plataforma"} · {r.users?.name ?? "Sistema"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-subtle tabular">{formatDateTime(r.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>

            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Quando</TH>
                    <TH>Empresa</TH>
                    <TH>Utilizador</TH>
                    <TH>Acção</TH>
                    <TH>Entidade</TH>
                    <TH>
                      <span className="sr-only">Detalhe</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap text-muted tabular">{formatDateTime(r.created_at)}</TD>
                      <TD className={r.companies ? "" : "text-muted"}>{r.companies?.name ?? "Plataforma"}</TD>
                      <TD>
                        {r.users ? (
                          <>
                            <span className="block">{r.users.name}</span>
                            <span className="block text-xs text-muted">{r.users.email}</span>
                          </>
                        ) : (
                          <span className="text-muted">Sistema</span>
                        )}
                      </TD>
                      <TD>
                        <span className="block">{ACTION_LABEL[r.action] ?? r.action}</span>
                        <span className="block font-mono text-[11px] text-subtle">{r.action}</span>
                      </TD>
                      <TD className="text-xs text-muted">
                        {r.entity}
                        {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                          Detalhe
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <Pagination page={page} pages={pages} onChange={setPage} />
          </div>
        )}
      </PageBody>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail ? (
          <DialogContent wide title={ACTION_LABEL[detail.action] ?? detail.action} description={formatDateTime(detail.created_at)}>
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              {(
                [
                  ["Empresa", detail.companies?.name ?? "Plataforma"],
                  ["Utilizador", detail.users ? `${detail.users.name} (${detail.users.email})` : "Sistema"],
                  ["Acção", detail.action],
                  ["Entidade", `${detail.entity}${detail.entity_id ? ` · ${detail.entity_id}` : ""}`],
                  ["IP", detail.ip ?? "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {(["before", "after"] as const).map((k) =>
              detail[k] ? (
                <div key={k} className="mt-4">
                  <p className="mb-1 text-xs font-medium text-muted">{k === "before" ? "Antes" : "Depois"}</p>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed">{JSON.stringify(detail[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
