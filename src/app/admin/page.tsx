import type { Metadata } from "next";
import Link from "next/link";
import { GroupedBars, Legend } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatMoney, MONTHS_PT } from "@/lib/format";
import { platformOverview } from "@/lib/queries/platform";
import { COMPANY_STATUS } from "./labels";

export const metadata: Metadata = { title: "Plataforma" };

export default async function PlatformDashboard() {
  await requireContext("platform.health.view");
  const o = await platformOverview();
  return (
    <>
      <PageHeader title="Plataforma" description="Empresas clientes, utilização e receita. Sem acesso a dados salariais das empresas." />
      <PageBody>
        <StatRow>
          <Stat label="Empresas activas" value={o.totals.active} hint={`${o.totals.trial} em período experimental`} />
          <Stat label="Colaboradores" value={o.totals.employees.toLocaleString("pt-PT")} hint="Activos em todas as empresas" />
          <Stat label="Marcações (24 h)" value={o.totals.events24h.toLocaleString("pt-PT")} />
          <Stat label="Receita recorrente" value={formatMoney(o.mrr)} hint={`${o.totals.openInvoices} facturas em aberto`} />
        </StatRow>
        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Card className="p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Receita cobrada</h2>
                <p className="text-xs text-muted">Facturas pagas por mês (MZN)</p>
              </div>
              <Legend items={[{ label: "Cobrado", color: CHART_COLORS.indigo }]} />
            </div>
            <GroupedBars data={o.revenueByMonth.map((r) => ({ month: `${MONTHS_PT[Number(r.month.slice(5)) - 1]?.slice(0, 3)}`, total: r.total }))} category="month" series={[{ key: "total", name: "Cobrado", tone: "strong" }]} />
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
