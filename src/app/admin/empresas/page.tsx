"use client";

import * as React from "react";
import { CompanyActions } from "@/components/admin/company-actions";
import { CompanyDialog } from "@/components/admin/company-form";
import { companyStatus, loadOverview, type AdminCompany } from "@/components/admin/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatDateTime } from "@/lib/format";
import { useData } from "@/lib/sb/use-data";

type Filter = "all" | "active" | "suspended" | "cancelled";

export default function CompaniesPage() {
  const { data, error, loading, reload } = useData(loadOverview, []);
  const [creating, setCreating] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [q, setQ] = React.useState("");

  const companies = data?.companies ?? [];
  // Empresas em "trial" (criadas antes) contam como activas: já não há período experimental.
  const statusOf = (c: AdminCompany): Filter => (c.status === "trial" ? "active" : c.status);
  const count = (s: Filter) => (s === "all" ? companies.length : companies.filter((c) => statusOf(c) === s).length);
  const term = q.trim().toLowerCase();
  const rows = companies.filter(
    (c) =>
      (filter === "all" || statusOf(c) === filter) &&
      (!term || [c.name, c.nuit, c.email, c.owner_login, c.phone].some((v) => v?.toLowerCase().includes(term))),
  );

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Empresas com acesso ao Horbit, responsável e estado."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!data}>
            Nova empresa
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            items={(
              [
                ["all", "Todas"],
                ["active", "Activas"],
                ["suspended", "Suspensas"],
                ["cancelled", "Canceladas"],
              ] as [Filter, string][]
            ).map(([key, label]) => ({ key, label, count: data ? count(key) : undefined }))}
            active={filter}
            onChange={setFilter}
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar nome, NUIT ou acesso"
            className="w-full lg:w-72"
            aria-label="Procurar empresas"
          />
        </div>

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={companies.length ? "Nenhuma empresa corresponde ao filtro" : "Ainda não há empresas"}
            description={companies.length ? "Altere a pesquisa ou o estado." : "Crie a primeira empresa cliente ou aprove um pedido de conta."}
            action={
              companies.length ? null : (
                <Button onClick={() => setCreating(true)}>
                  Nova empresa
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Telemóvel: cartões */}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border lg:hidden">
              {rows.map((c) => (
                <li key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-bold tracking-[-0.01em]">{c.name}</p>
                      <p className="truncate font-mono text-[12px] text-muted">{c.owner_login ?? "Sem responsável"}</p>
                    </div>
                    <CompanyActions company={c} onChanged={reload} />
                  </div>
                  <Badge tone={companyStatus(c.status).tone} className="mt-2">
                    {companyStatus(c.status).label}
                  </Badge>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
                    <div>
                      <dt className="text-[12px] text-muted">Colaboradores</dt>
                      <dd className="tabular">
                        <Employees c={c} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">NUIT</dt>
                      <dd className="tabular">{c.nuit ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-muted">Última marcação</dt>
                      <dd>{c.last_activity ? formatDateTime(c.last_activity) : "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            {/* Desktop: tabela */}
            <TableWrap className="hidden lg:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Empresa</TH>
                    <TH>Responsável</TH>
                    <TH>Colaboradores</TH>
                    <TH>Última marcação</TH>
                    <TH>Desde</TH>
                    <TH>Estado</TH>
                    <TH className="w-24">
                      <span className="sr-only">Acções</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((c) => {
                    const st = companyStatus(c.status);
                    return (
                      <TR key={c.id}>
                        <TD>
                          <span className="block font-bold">{c.name}</span>
                          {c.nuit ? <span className="block text-[12px] text-muted tabular">NUIT {c.nuit}</span> : null}
                          {c.email ? <span className="block text-[12px] text-muted">{c.email}</span> : null}
                        </TD>
                        <TD className="font-mono text-[12.5px] text-muted">{c.owner_login ?? "—"}</TD>
                        <TD className="tabular">
                          <Employees c={c} />
                        </TD>
                        <TD className="text-muted">{c.last_activity ? formatDateTime(c.last_activity) : "Sem marcações"}</TD>
                        <TD className="text-muted">{formatDate(c.created_at)}</TD>
                        <TD>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </TD>
                        <TD className="text-right">
                          <CompanyActions company={c} onChanged={reload} />
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </>
        )}
      </PageBody>

      {data ? <CompanyDialog open={creating} onOpenChange={setCreating} onCreated={reload} /> : null}
    </>
  );
}

function Employees({ c }: { c: AdminCompany }) {
  return <span className="font-bold tabular">{c.employees}</span>;
}
