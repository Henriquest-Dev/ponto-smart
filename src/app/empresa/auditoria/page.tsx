"use client";

import * as React from "react";
import { AuditFilters, AuditList, type AuditCategoryFilter, type AuditListRow } from "@/components/audit/audit-list";
import { ErrorBlock, NoAccess } from "@/components/company/p2-shared";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { actionsForCategory } from "@/lib/audit-text";
import { loadAuditContext } from "@/lib/sb/audit-refs";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const PAGE = 30;

type Row = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
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
  const [category, setCategory] = React.useState<AuditCategoryFilter>("all");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);

  const data = useData(async () => {
    // "audit_log_clean" (04_parte7.sql) esconde o ruído da estação; sem o script, usa a tabela.
    const build = (table: "audit_log_clean" | "audit_logs") => {
      let query = sb()
        .from(table)
        .select("id,actor_id,action,entity,entity_id,before,after,created_at,users(name)", { count: "exact" })
        .eq("company_id", companyId);
      if (category !== "all") query = query.in("action", actionsForCategory(category));
      return query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    };
    let res = await build("audit_log_clean");
    if (res.error && /audit_log_clean/.test(res.error.message)) res = await build("audit_logs");
    const rows = (must(res) as unknown as Row[]).map<AuditListRow>((r) => ({ ...r, actorName: r.users?.name }));
    return { rows, total: res.count ?? 0, context: await loadAuditContext(rows) };
  }, [companyId, category, page]);

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê, a quem e quando." />
      <PageBody>
        <AuditFilters
          category={category}
          onCategory={(c) => {
            setPage(1);
            setCategory(c);
          }}
          search={search}
          onSearch={setSearch}
        />

        {data.error ? <ErrorBlock message={data.error} /> : null}
        {data.loading && !data.data ? <Skeleton className="h-96 w-full rounded-xl" /> : null}
        {data.data && data.data.rows.length === 0 ? <EmptyState title="Sem registos" description="Ainda não há acções nesta categoria." /> : null}
        {data.data && data.data.rows.length > 0 ? (
          <div className={data.loading ? "opacity-60" : undefined}>
            <AuditList rows={data.data.rows} context={data.data.context} search={search} tz={tz} />
          </div>
        ) : null}
        {data.data ? <Pagination page={page} pages={Math.ceil(data.data.total / PAGE)} onChange={setPage} /> : null}
      </PageBody>
    </>
  );
}
