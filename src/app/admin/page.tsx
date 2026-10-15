"use client";

import Link from "next/link";
import * as React from "react";
import { CompanyDialog } from "@/components/admin/company-form";
import { companyStatus, loadOverview, mrr } from "@/components/admin/data";
import { GroupedBars, Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime, formatNumber } from "@/lib/format";
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
            Nova empresa
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {pending.length ? (
          <Link
            href="/admin/pedidos/"
            className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] bg-primary px-5 py-4 text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <span className="text-[30px] leading-none font-extrabold tracking-[-0.02em] tabular">{pending.length}</span>
            <span className="min-w-0 flex-1 text-[14px] leading-snug">
              <span className="block font-extrabold">{pending.length === 1 ? "Pedido de conta" : "Pedidos de conta"} à espera de aprovação</span>
              <span className="block text-primary-foreground/70">Mais antigo recebido {formatDateTime(pending.reduce((a, r) => (r.created_at < a ? r.created_at : a), pending[0].created_at))}</span>
            </span>
            <span className="rounded-full bg-background px-4 py-2 text-[13px] font-bold text-primary">Rever pedidos</span>
          </Link>
        ) : null}

        {loading && !data ? (
          <Skeleton className="h-[118px] rounded-[22px]" />
        ) : (
          <StatRow>
            <Stat label="Empresas activas" value={active} hint={`${trial} em período experimental${suspended ? `, ${suspended} suspensas` : ""}`} />
            <Stat label="Colaboradores" value={formatNumber(employees)} hint="Activos nas empresas com acesso" />
            <Stat label="Receita recorrente" value={`${formatNumber(Math.round(mrr(companies)))} MZN`} hint="Por mês, empresas activas e experimentais" />
            <Stat label="Pedidos pendentes" value={pending.length} hint={pending[0] ? `Último: ${formatDateTime(pending[0].created_at)}` : "Nenhum por tratar"} />
          </StatRow>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="min-w-0 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-extrabold tracking-[-0.01em]">Actividade da plataforma</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Marcações por dia nos últimos 30 dias
                  {data ? `, ${formatNumber(events30)} no total` : ""}
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
              <p className="mt-3 text-[13px] text-muted">
                Hoje: <span className="font-extrabold text-foreground tabular">{formatNumber(today.events)}</span> marcações em{" "}
                <span className="font-extrabold text-foreground tabular">{today.companies}</span> {today.companies === 1 ? "empresa" : "empresas"}.
              </p>
            ) : null}
          </Card>

          <Card className="min-w-0 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-extrabold tracking-[-0.01em]">Crescimento</h2>
                <p className="mt-0.5 text-[13px] text-muted">Total acumulado no fim de cada mês</p>
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
          <SectionTitle
            title="Empresas recentes"
            action={
              <Link
                href="/admin/empresas/"
                className="text-[13px] font-bold text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary"
              >
                Ver todas
              </Link>
            }
          />
          {loading && !data ? (
            <Skeleton className="h-64 rounded-[22px]" />
          ) : companies.length === 0 ? (
            <EmptyState
              title="Ainda não há empresas"
              description="Crie a primeira empresa cliente ou aprove um pedido de conta."
              action={
                <Button onClick={() => setCreating(true)}>
                  Nova empresa
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
                    <TH>Colaboradores</TH>
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
                          <span className="block font-bold">{c.name}</span>
                          <span className="block font-mono text-[12px] text-muted">{c.owner_login ?? "Sem responsável"}</span>
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
