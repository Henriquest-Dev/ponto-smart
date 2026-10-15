"use client";

import { FileText } from "lucide-react";
import { ABSENCE_TYPES, loadPendingDays, useTitle } from "@/components/collab/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatDate, formatDateTime } from "@/lib/format";
import { ABSENCE_STATUS, STEP_DECISION } from "@/lib/labels";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { CancelAbsence, DocumentLink, NewAbsence } from "./absence-forms";

type Request = {
  id: string;
  start_date: string;
  end_date: string;
  type: string;
  reason: string;
  status: string;
  decision_reason: string | null;
  created_at: string;
  approval_steps: { id: string; step_order: number; approver_role: string; decision: string }[];
  absence_documents: { id: string; file_name: string; storage_key: string }[];
};

export default function AbsencesPage() {
  useTitle("Justificações");
  const { company, companyId, tz } = useCompany();
  const employeeId = company.employeeId!;

  const { data, error, loading, reload } = useData(async () => {
    const [requests, pending] = await Promise.all([
      sb()
        .from("absence_requests")
        .select(
          "id,start_date,end_date,type,reason,status,decision_reason,created_at,approval_steps(id,step_order,approver_role,decision),absence_documents(id,file_name,storage_key)",
        )
        .eq("company_id", companyId)
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(must),
      loadPendingDays(companyId, employeeId),
    ]);
    return { requests: (requests ?? []) as Request[], open: pending.filter((d) => d.status === "absent_pending") };
  }, [companyId, employeeId]);

  return (
    <>
      <PageHeader
        title="Justificações"
        description="Pedidos de justificação de faltas e ausências."
        actions={<NewAbsence companyId={companyId} suggestions={data?.open.map((d) => d.work_date) ?? []} onDone={reload} />}
      />
      <PageBody className="mx-auto max-w-4xl">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {data?.open.length ? (
          <Notice tone="warning" title="Dias por justificar">
            {data.open.map((d) => formatDate(d.work_date, tz)).join(" · ")}
          </Notice>
        ) : null}

        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : data && data.requests.length === 0 ? (
          <EmptyState icon={<FileText />} title="Sem pedidos" description="Quando submeter uma justificação, poderá acompanhar aqui o estado da aprovação." />
        ) : data ? (
          <div className="space-y-3">
            {data.requests.map((r) => {
              const st = ABSENCE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const steps = [...r.approval_steps].sort((a, b) => a.step_order - b.step_order);
              return (
                <Card key={r.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{ABSENCE_TYPES[r.type] ?? r.type}</p>
                      <p className="mt-0.5 text-[13px] text-muted tabular">
                        {r.start_date === r.end_date ? formatDate(r.start_date, tz) : `${formatDate(r.start_date, tz)} – ${formatDate(r.end_date, tz)}`}
                        {" · "}submetido {formatDateTime(r.created_at, tz)}
                      </p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed break-words">{r.reason}</p>
                  {r.absence_documents.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.absence_documents.map((d) => (
                        <DocumentLink key={d.id} path={d.storage_key} name={d.file_name} />
                      ))}
                    </div>
                  ) : null}
                  {steps.length ? (
                    <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
                      {steps.map((s) => {
                        const dec = STEP_DECISION[s.decision] ?? { label: s.decision, tone: "neutral" as const };
                        return (
                          <li key={s.id} className="flex items-center gap-2 text-xs">
                            <span className="text-muted">{s.approver_role === "supervisor" ? "Supervisor" : "Recursos Humanos"}</span>
                            <Badge tone={dec.tone}>{dec.label}</Badge>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  {r.decision_reason ? <p className="mt-3 rounded-md bg-surface px-3 py-2 text-xs text-muted">Fundamento: {r.decision_reason}</p> : null}
                  {r.status === "pending" ? (
                    <div className="mt-3 flex justify-end">
                      <CancelAbsence id={r.id} onDone={reload} />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
