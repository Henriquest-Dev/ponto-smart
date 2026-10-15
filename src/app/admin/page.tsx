import { ArrowRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import { rollingAverage } from "@/lib/series";
import Link from "next/link";
import { GroupedBars, Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatMoney, MONTHS_PT } from "@/lib/format";
import { pendingRequestCount, platformAttendanceTrend, platformOverview } from "@/lib/queries/platform";
import { COMPANY_STATUS } from "./labels";

export const metadata: Metadata = { title: "Plataforma" };

export default async function PlatformDashboard() {
  await requireContext("platform.health.view");
  const [o, rawTrend, pending] = await Promise.all([platformOverview(), platformAttendanceTrend(), pendingRequestCount()]);
  const trend = rollingAverage(rawTrend, ["pontualidade", "presenca"]);
  const usage = o.companies.map((c) => ({ empresa: c.name.split(" ")[0], colaboradores: c.employees, limite: c.subscription?.plan.maxEmployees ?? 0 }));
  const revenue = o.revenueByMonth.map((r) => ({ mes: MONTHS_PT[Number(r.month.slice(5)) - 1]?.slice(0, 3) ?? r.month, cobrado: r.total }));

  return (
    <>
      <PageHeader title="Plataforma" description="Empresas clientes, utilização e receita. Sem acesso a dados salariais das empresas." />
      <PageBody>
        {pending ? (
          <Link href="/admin/empresas" className="group flex items-center gap-3 rounded-xl border border-primary/25 bg-primary-soft/40 px-4 py-3.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary"><Inbox className="size-[18px]" /></span>
            <span className="flex-1 text-[13px]">
              <span className="font-semibold">{pending} {pending === 1 ? "pedido de conta" : "pedidos de conta"}</span> à espera de aprovação
            </span>
            <ArrowRight className="size-4 text-primary transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : null}

        <StatRow>
          <Stat label="Empresas activas" value={o.totals.active} hint={`${o.totals.trial} em período experimental`} />
          <Stat label="Colaboradores" value={o.totals.employees.toLocaleString("pt-PT")} hint="Activos em todas as empresas" />
          <Stat label="Marcações (24 h)" value={o.totals.events24h.toLocaleString("pt-PT")} />
          <Stat label="Receita recorrente" value={formatMoney(o.mrr)} hint={`${o.totals.openInvoices} facturas em aberto`} />
        </StatRow>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Pontualidade e presença</h2>
                <p className="text-xs text-muted">Todas as empresas · média móvel de 7 dias</p>
              </div>
              <Legend items={[{ label: "Pontualidade", color: CHART_COLORS.primary }, { label: "Presença", color: CHART_COLORS.indigo }]} />
            </div>
            <SmoothArea data={trend} category="date" categoryFormat="date" percent series={[{ key: "pontualidade", name: "Pontualidade %" }, { key: "presenca", name: "Presença %" }]} />
          </Card>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Utilização por empresa</h2>
                <p className="text-xs text-muted">Colaboradores activos face ao limite do plano</p>
              </div>
              <Legend items={[{ label: "Activos", color: CHART_COLORS.indigo }, { label: "Limite", color: CHART_COLORS.indigoSoft }]} />
            </div>
            <GroupedBars data={usage} category="empresa" series={[{ key: "colaboradores", name: "Activos", tone: "strong" }, { key: "limite", name: "Limite do plano", tone: "soft" }]} />
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Card className="p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Receita cobrada</h2>
                <p className="text-xs text-muted">Facturas pagas por mês (MZN)</p>
              </div>
              <Legend items={[{ label: "Cobrado", color: CHART_COLORS.indigo }]} />
            </div>
            <GroupedBars data={revenue} category="mes" series={[{ key: "cobrado", name: "Cobrado", tone: "strong" }]} />
          </Card>
          <section>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-[17px] font-semibold tracking-tight">Empresas</h2>
              <Link href="/admin/empresas" className="text-[13px] font-medium text-primary">Gerir</Link>
            </div>
            <TableWrap>
              <Table>
                <THead><tr><TH>Empresa</TH><TH>Plano</TH><TH>Colab.</TH><TH>Marcações 24h</TH><TH>Estado</TH></tr></THead>
                <tbody>
                  {o.companies.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-medium">{c.name}</TD>
                      <TD className="text-muted">{c.subscription?.plan.name ?? "—"}</TD>
                      <TD className="tabular">{c.employees}{c.subscription ? <span className="text-muted"> / {c.subscription.plan.maxEmployees}</span> : null}</TD>
                      <TD className="tabular">{c.events24h}</TD>
                      <TD><Badge tone={COMPANY_STATUS[c.status].tone}>{COMPANY_STATUS[c.status].label}</Badge></TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </section>
        </div>
      </PageBody>
    </>
  );
}
