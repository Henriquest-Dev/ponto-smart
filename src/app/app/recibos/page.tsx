"use client";

import { Receipt } from "lucide-react";
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
          A confirmação de recepção indica apenas que recebeu o recibo — não equivale a comprovativo de pagamento bancário.
        </Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {loading && !slips ? (
          <div className="space-y-3">
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        ) : slips && slips.length === 0 ? (
          <EmptyState icon={<Receipt />} title="Ainda sem recibos" description="Os recibos aparecem aqui depois de o processamento ser aprovado e emitido." />
        ) : slips ? (
          <div className="space-y-3">
            {slips.map((s) => (
              <Card key={s.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Receipt className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">{periodLabel(s.year, s.month)}</p>
                    <p className="truncate text-xs text-muted">Ref. {s.reference}</p>
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
                    <p className="text-xs text-muted">{s.payment ? "Pagamento" : "Emitido"}</p>
                    {s.payment ? (
                      <p className="font-medium">
                        Registado {formatDate(s.payment.paidAt, tz)} · {PAYMENT_METHODS[s.payment.method] ?? s.payment.method}
                      </p>
                    ) : (
                      <p className="font-medium">{formatDate(s.issuedAt, tz)}</p>
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
