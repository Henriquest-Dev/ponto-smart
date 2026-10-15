import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDate, formatMoney } from "@/lib/format";
import { platformOverview } from "@/lib/queries/platform";
import { setInvoiceStatusAction } from "../actions";
import { INVOICE_STATUS } from "../labels";

export const metadata: Metadata = { title: "Facturação" };

export default async function BillingPage() {
  await requireContext("platform.billing.manage");
  const o = await platformOverview();
  const sum = (s: string) => o.invoices.filter((i) => i.i.status === s).reduce((a, i) => a + Number(i.i.amount), 0);
  return (
    <>
      <PageHeader title="Facturação" description="Facturas de subscrição e estado de pagamento." />
      <PageBody>
        <StatRow>
          <Stat label="Receita recorrente" value={formatMoney(o.mrr)} />
          <Stat label="Em aberto" value={formatMoney(sum("issued"))} />
          <Stat label="Cobrado" value={formatMoney(sum("paid"))} />
          <Stat label="Facturas" value={o.invoices.length} />
        </StatRow>
        <TableWrap>
          <Table>
            <THead><tr><TH>Número</TH><TH>Empresa</TH><TH>Emissão</TH><TH>Vencimento</TH><TH className="text-right">Valor</TH><TH>Estado</TH><TH /></tr></THead>
            <tbody>
              {o.invoices.map(({ i, company }) => (
                <TR key={i.id}>
                  <TD className="font-mono text-xs">{i.number}</TD>
                  <TD className="font-medium">{company}</TD>
                  <TD className="text-muted">{formatDate(i.issuedAt)}</TD>
                  <TD className="text-muted">{formatDate(i.dueAt)}</TD>
                  <TD className="text-right tabular">{formatMoney(i.amount, i.currency)}</TD>
                  <TD><Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>{i.paidAt ? <span className="ml-2 text-xs text-muted">{formatDate(i.paidAt)}</span> : null}</TD>
                  <TD className="text-right">
                    {i.status === "issued" || i.status === "draft" ? (
                      <span className="flex justify-end gap-1">
                        <ActionButton size="sm" variant="soft" action={setInvoiceStatusAction.bind(null, i.id, "paid")}>Marcar paga</ActionButton>
                        <ActionButton size="sm" variant="ghost" action={setInvoiceStatusAction.bind(null, i.id, "void")} confirm="Anular esta factura?">Anular</ActionButton>
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </PageBody>
    </>
  );
}
