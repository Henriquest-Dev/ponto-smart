"use client";

import { loadMyPayslips, useTitle } from "@/components/collab/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatDate, formatMoney, periodLabel } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/labels";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { AcknowledgeButton, DownloadPayslip } from "./acknowledge";

export default function PayslipsPage() {
  useTitle("Recibos");
  const { company, companyId, tz } = useCompany();
  const employeeId = company.employeeId!;
  const { data: slips, error, loading, reload } = useData(() => loadMyPayslips(companyId, employeeId), [companyId, employeeId]);

  return (
    <>
      <PageHeader title="Recibos" description="Recibos de vencimento emitidos após aprovação." />
      <PageBody className="mx-auto max-w-4xl">
        <Notice tone="info">
          A confirmação de recepção indica apenas que recebeu o recibo. Não equivale a comprovativo de pagamento bancário.
        </Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {loading && !slips ? (
          <div className="space-y-3">
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        ) : slips && slips.length === 0 ? (
          <EmptyState title="Ainda sem recibos" description="Os recibos aparecem aqui depois de o processamento ser aprovado e emitido." />
        ) : slips ? (
          <div className="space-y-3">
            {slips.map((s, i) => (
              <Card key={s.id} className={i === 0 ? "border-2 border-primary/25 p-5 sm:p-6" : "p-5 sm:p-6"}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]">
                      {i === 0 ? <span className="stem text-primary" aria-hidden /> : null}
                      {periodLabel(s.year, s.month)}
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted tabular">Ref. {s.reference}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12.5px] font-bold text-muted">Líquido</p>
                    <p className="text-[30px] leading-none font-bold tracking-[-0.02em] tabular">{formatMoney(s.net, s.currency)}</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-surface px-4 py-3.5 text-[13.5px] sm:grid-cols-3">
                  <div>
                    <p className="text-[12px] text-muted">Ilíquido</p>
                    <p className="font-bold tabular">{formatMoney(s.gross, s.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-muted">Descontos</p>
                    <p className="font-bold text-danger tabular">{formatMoney(s.deductions, s.currency)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-[12px] text-muted">{s.payment ? "Pagamento" : "Emitido"}</p>
                    {s.payment ? (
                      <p className="font-bold">
                        Registado {formatDate(s.payment.paidAt, tz)}, {PAYMENT_METHODS[s.payment.method] ?? s.payment.method}
                      </p>
                    ) : (
                      <p className="font-bold">{formatDate(s.issuedAt, tz)}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  {s.acknowledgedAt ? (
                    <Badge tone="success">Recepção confirmada em {formatDate(s.acknowledgedAt, tz)}</Badge>
                  ) : (
                    <AcknowledgeButton id={s.id} onDone={reload} />
                  )}
                  <DownloadPayslip slip={s} companyId={companyId} employeeId={employeeId} />
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
