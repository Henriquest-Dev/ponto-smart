"use client";

import * as React from "react";
import { AuditFilters, AuditList, type AuditCategoryFilter, type AuditListRow } from "@/components/audit/audit-list";
import { Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { actionsForCategory } from "@/lib/audit-text";
import { formatNumber } from "@/lib/format";
import { loadAuditContext } from "@/lib/sb/audit-refs";
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

function first<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function PlatformAuditPage() {
  const [page, setPage] = React.useState(1);
  const [company, setCompany] = React.useState("all");
  const [category, setCategory] = React.useState<AuditCategoryFilter>("all");
  const [search, setSearch] = React.useState("");

  const companies = useData(async () => must(await sb().from("companies").select("id,name").order("name")) as { id: string; name: string }[], []);

  const { data, error, loading } = useData(async () => {
    // "audit_log_clean" (04_parte7.sql) esconde o ruído da estação; sem o script, usa a tabela.
    const build = (table: "audit_log_clean" | "audit_logs") => {
      let q = sb()
        .from(table)
        .select("id,company_id,actor_id,action,entity,entity_id,before,after,ip,created_at,companies(name),users(name,email)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE, page * PAGE - 1);
      if (company === "platform") q = q.is("company_id", null);
      else if (company !== "all") q = q.eq("company_id", company);
      if (category !== "all") q = q.in("action", actionsForCategory(category));
      return q;
    };
    let res = await build("audit_log_clean");
    if (res.error && /audit_log_clean/.test(res.error.message)) res = await build("audit_logs");
    const raw = must(res) as unknown as (Omit<Row, "companies" | "users"> & { companies: unknown; users: unknown })[];
    const rows = raw.map<AuditListRow>((r) => {
      const c = first(r.companies as Row["companies"]);
      const u = first(r.users as Row["users"]);
      return { ...r, actorName: u?.name, meta: c?.name ?? "Plataforma" };
    });
    return { rows, total: res.count ?? 0, context: await loadAuditContext(rows) };
  }, [page, company, category]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê, em que empresa e quando, em toda a plataforma." />
      <PageBody>
        <AuditFilters
          category={category}
          onCategory={(c) => {
            setCategory(c);
            setPage(1);
          }}
          search={search}
          onSearch={setSearch}
        >
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
        </AuditFilters>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <EmptyState title="Sem registos" description={category !== "all" || company !== "all" ? "Nenhum registo corresponde aos filtros." : undefined} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="mb-3 text-[13px] text-muted">
              <span className="text-[15px] font-bold text-foreground tabular">{formatNumber(data.total)}</span> registos
            </p>
            <AuditList rows={data.rows} context={data.context} search={search} />
            <Pagination page={page} pages={pages} onChange={setPage} />
          </div>
        )}
      </PageBody>
    </>
  );
}
