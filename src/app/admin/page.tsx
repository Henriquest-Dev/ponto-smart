"use client";

import { ArrowRight, Inbox, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CompanyDialog } from "@/components/admin/company-form";
import { companyStatus, loadOverview, mrr } from "@/components/admin/data";
import { GroupedBars, Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useData } from "@/lib/sb/use-data";

export default function PlatformOverviewPage() {
  const { data, error, loading, reload } = useData(loadOverview, []);
  const [creating, setCreating] = React.useState(false);
  const [growthKey, setGrowthKey] = React.useState<"companies" | "employees">("companies");

  const companies = data?.companies ?? [];
  const pending = (data?.requests ?? []).filter((r) => r.status === "pending");
  const active = companies.filter((c) => c.status === "active").length;
  const trial = companies.filter((c) => c.status === "trial").length;
  const suspended = companies.filter((c) => c.status === "suspended").length;
  const employees = companies.filter((c) => c.status === "active" || c.status === "trial").reduce((s, c) => s + c.employees, 0);
  const activity = data?.activity ?? [];
  const today = activity[activity.length - 1];
  const events30 = activity.reduce((s, a) => s + a.events, 0);

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Empresas clientes, utilização e receita. Sem acesso a dados salariais das empresas."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!data}>
            <Plus /> Nova empresa
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {pending.length ? (
          <Link href="/admin/pedidos/" className="group flex items-center gap-3 rounded-xl border border-primary/25 bg-primary-soft/40 px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Inbox className="size-[18px]" />
            </span>
            <span className="flex-1 text-[13px]">
              <span className="font-semibold">
                {pending.length} {pending.length === 1 ? "pedido de conta" : "pedidos de conta"}
              </span>{" "}
              à espera de aprovação
            </span>
            <ArrowRight className="size-4 text-primary transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : null}

        {loading && !data ? (
          <Skeleton className="h-[118px] rounded-xl" />
        ) : (
          <StatRow>
            <Stat label="Empresas activas" value={active} hint={`${trial} em período experimental${suspended ? ` · ${suspended} suspensas` : ""}`} />
            <Stat label="Colaboradores" value={formatNumber(employees)} hint="Activos nas empresas com acesso" />
            <Stat label="Receita recorrente" value={formatMoney(mrr(companies))} hint="Mensal · empresas activas e experimentais" />
            <Stat label="Pedidos pendentes" value={pending.length} hint={pending[0] ? `Último: ${formatDateTime(pending[0].created_at)}` : "Nenhum por tratar"} />
          </StatRow>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="min-w-0 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Actividade da plataforma</h2>
                <p className="text-xs text-muted">
                  Marcações por dia · últimos 30 dias
                  {data ? ` · ${formatNumber(events30)} no total` : ""}
                </p>
              </div>
              <Legend items={[{ label: "Marcações", color: CHART_COLORS.primary }]} />
            </div>
            {loading && !data ? (
              <Skeleton className="h-60" />
            ) : (
              <SmoothArea data={activity} category="date" categoryFormat="date" series={[{ key: "events", name: "Marcações" }]} />
            )}
            {today ? (
              <p className="mt-3 text-xs text-muted">
                Hoje: <span className="font-medium text-foreground tabular">{formatNumber(today.events)}</span> marcações em{" "}
                <span className="font-medium text-foreground tabular">{today.companies}</span> {today.companies === 1 ? "empresa" : "empresas"}.
              </p>
            ) : null}
          </Card>

          <Card className="min-w-0 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Crescimento</h2>
                <p className="text-xs text-muted">Total acumulado no fim de cada mês</p>
              </div>
              <Tabs
                items={[
                  { key: "companies", label: "Empresas" },
                  { key: "employees", label: "Colaboradores" },
                ]}
                active={growthKey}
                onChange={setGrowthKey}
              />
            </div>
            {loading && !data ? (
              <Skeleton className="h-56" />
            ) : (
              <GroupedBars
                data={(data?.growth ?? []).map((g) => ({ mes: shortMonth(g.month), [growthKey]: g[growthKey] }))}
                category="mes"
                series={[{ key: growthKey, name: growthKey === "companies" ? "Empresas" : "Colaboradores", tone: "strong" }]}
              />
            )}
          </Card>
        </div>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold tracking-tight">Empresas recentes</h2>
            <Link href="/admin/empresas/" className="text-[13px] font-medium text-primary">
              Ver todas
            </Link>
          </div>
          {loading && !data ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : companies.length === 0 ? (
            <EmptyState
              title="Ainda não há empresas"
              description="Crie a primeira empresa cliente ou aprove um pedido de conta."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Nova empresa
                </Button>
              }
            />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Empresa</TH>
                    <TH>Plano</TH>
                    <TH>Colab.</TH>
                    <TH>Última marcação</TH>
                    <TH>Estado</TH>
                  </tr>
                </THead>
                <tbody>
                  {companies.slice(0, 8).map((c) => {
                    const st = companyStatus(c.status);
                    return (
                      <TR key={c.id}>
                        <TD>
                          <span className="block font-medium">{c.name}</span>
                          <span className="block text-xs text-muted">{c.owner_login ?? "—"}</span>
                        </TD>
                        <TD className="text-muted">{c.plan ?? "—"}</TD>
                        <TD className="tabular">{c.employees}</TD>
                        <TD className="text-muted">{c.last_activity ? formatDateTime(c.last_activity) : "Sem marcações"}</TD>
                        <TD>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </section>
      </PageBody>

      {data ? <CompanyDialog open={creating} onOpenChange={setCreating} plans={data.plans} onCreated={reload} /> : null}
    </>
  );
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function shortMonth(ym: string) {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}`;
}
