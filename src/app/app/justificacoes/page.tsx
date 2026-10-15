import { FileText, Paperclip } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { requireEmployee } from "@/lib/auth/context";
import { ABSENCE_TYPES } from "@/lib/domain/absence";
import { formatDate, formatDateTime } from "@/lib/format";
import { ABSENCE_STATUS, STEP_DECISION } from "@/lib/labels";
import { myAbsences, unjustifiedDays } from "@/lib/queries/employee";
import { CancelAbsence, NewAbsence } from "./absence-forms";

export const metadata: Metadata = { title: "Justificações" };

export default async function AbsencesPage() {
  const ctx = await requireEmployee();
  const tz = ctx.company.timezone;
  const [requests, pending] = await Promise.all([myAbsences(ctx.company.id, ctx.employee.id), unjustifiedDays(ctx.company.id, ctx.employee.id)]);
  const open = pending.filter((d) => d.status === "absent_pending");

  return (
    <>
      <PageHeader title="Justificações" description="Pedidos de justificação de faltas e ausências." actions={<NewAbsence suggestions={open.map((d) => d.workDate)} />} />
      <PageBody className="mx-auto max-w-4xl">
        {open.length ? (
          <Notice tone="warning" title="Dias por justificar">
            {open.map((d) => formatDate(d.workDate, tz)).join(" · ")}
          </Notice>
        ) : null}

        {requests.length === 0 ? (
          <EmptyState icon={<FileText />} title="Sem pedidos" description="Quando submeter uma justificação, poderá acompanhar aqui o estado da aprovação." />
        ) : (
          <div className="space-y-3">
            {requests.map((r) => {
              const st = ABSENCE_STATUS[r.status];
              return (
                <Card key={r.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{ABSENCE_TYPES[r.type] ?? r.type}</p>
                      <p className="mt-0.5 text-[13px] text-muted tabular">
                        {r.startDate === r.endDate ? formatDate(r.startDate, tz) : `${formatDate(r.startDate, tz)} – ${formatDate(r.endDate, tz)}`}
                        {" · "}submetido {formatDateTime(r.createdAt, tz)}
                      </p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed">{r.reason}</p>
                  {r.documents.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.documents.map((d) => (
                        <a key={d.id} href={`/api/absence-documents/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface">
                          <Paperclip className="size-3.5" /> {d.fileName}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
                    {r.steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted">{s.approverRole === "supervisor" ? "Supervisor" : "Recursos Humanos"}</span>
                        <Badge tone={STEP_DECISION[s.decision].tone}>{STEP_DECISION[s.decision].label}</Badge>
                      </li>
                    ))}
                  </ol>
                  {r.decisionReason ? <p className="mt-3 rounded-md bg-surface px-3 py-2 text-xs text-muted">Fundamento: {r.decisionReason}</p> : null}
                  {r.status === "pending" ? (
                    <div className="mt-3 flex justify-end">
                      <CancelAbsence id={r.id} />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
