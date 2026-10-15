import { Download, Receipt } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { requireEmployee } from "@/lib/auth/context";
import { formatDate, formatMoney, periodLabel } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/labels";
import { myPayslips } from "@/lib/queries/employee";
import { AcknowledgeButton } from "./acknowledge";

export const metadata: Metadata = { title: "Recibos" };

export default async function PayslipsPage() {
  const ctx = await requireEmployee();
  const tz = ctx.company.timezone;
  const slips = await myPayslips(ctx.company.id, ctx.employee.id);
  return (
    <>
      <PageHeader title="Recibos" description="Recibos de vencimento emitidos após aprovação." />
      <PageBody className="mx-auto max-w-4xl">
        <Notice tone="info">
          A confirmação de recepção indica apenas que recebeu o recibo — não equivale a comprovativo de pagamento bancário.
        </Notice>
        {slips.length === 0 ? (
          <EmptyState icon={<Receipt />} title="Ainda sem recibos" description="Os recibos aparecem aqui depois de o processamento ser aprovado e emitido." />
        ) : (
          <div className="space-y-3">
            {slips.map((s) => (
              <Card key={s.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Receipt className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{periodLabel(s.year, s.month)}</p>
                    <p className="text-xs text-muted">Ref. {s.reference}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">Líquido</p>
                    <p className="text-[18px] font-semibold tracking-tight tabular">{formatMoney(s.net, s.currency)}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface/70 px-4 py-3 text-[13px] sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted">Ilíquido</p>
                    <p className="font-medium tabular">{formatMoney(s.gross, s.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Descontos</p>
                    <p className="font-medium tabular">{formatMoney(s.deductions, s.currency)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-xs text-muted">Pagamento</p>
                    {s.payments.length ? (
                      <p className="font-medium">
                        Registado {formatDate(s.payments[0].paidAt, tz)} · {PAYMENT_METHODS[s.payments[0].method] ?? s.payments[0].method}
                      </p>
                    ) : (
                      <p className="font-medium text-muted">Ainda não registado</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  {s.acknowledgedAt ? (
                    <Badge tone="success">Recepção confirmada em {formatDate(s.acknowledgedAt, tz)}</Badge>
                  ) : (
                    <AcknowledgeButton id={s.id} />
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/payslips/${s.id}`} target="_blank" rel="noreferrer">
                      <Download /> PDF
                    </a>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
