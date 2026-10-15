"use client";

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
          <div className="rounded-[22px] bg-warning-soft p-5 text-[#6f4100]">
            <p className="flex items-baseline gap-2.5">
              <span className="text-[34px] leading-none font-extrabold tabular">{data.open.length}</span>
              <span className="text-[15px] font-extrabold">{data.open.length === 1 ? "dia por justificar" : "dias por justificar"}</span>
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.open.map((d) => (
                <li key={d.id} className="rounded-full bg-white/70 px-3 py-1 text-[13px] font-bold tabular">
                  {formatDate(d.work_date, tz)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-[22px]" />
            <Skeleton className="h-40 rounded-[22px]" />
          </div>
        ) : data && data.requests.length === 0 ? (
          <EmptyState title="Sem pedidos" description="Quando submeter uma justificação, poderá acompanhar aqui o estado da aprovação." />
        ) : data ? (
          <div className="space-y-3">
            {data.requests.map((r) => {
              const st = ABSENCE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const steps = [...r.approval_steps].sort((a, b) => a.step_order - b.step_order);
              return (
                <Card key={r.id} className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[17px] font-extrabold tracking-[-0.01em]">{ABSENCE_TYPES[r.type] ?? r.type}</p>
                      <p className="mt-1 text-[14px] font-bold tabular">
                        {r.start_date === r.end_date ? formatDate(r.start_date, tz) : `${formatDate(r.start_date, tz)} a ${formatDate(r.end_date, tz)}`}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-muted tabular">Submetido {formatDateTime(r.created_at, tz)}</p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="mt-3 text-[14px] leading-relaxed break-words">{r.reason}</p>
                  {r.absence_documents.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.absence_documents.map((d) => (
                        <DocumentLink key={d.id} path={d.storage_key} name={d.file_name} />
                      ))}
                    </div>
                  ) : null}
                  {steps.length ? (
                    <ol className="mt-5 grid gap-3" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Aprovação">
                      {steps.map((s) => {
                        const dec = STEP_DECISION[s.decision] ?? { label: s.decision, tone: "neutral" as const };
                        const fill =
                          dec.tone === "success" ? "bg-success" : dec.tone === "danger" ? "bg-danger" : dec.tone === "warning" ? "bg-warning/50" : "bg-surface-2";
                        return (
                          <li key={s.id} className="min-w-0">
                            <span className={`block h-2 rounded-full ${fill}`} aria-hidden />
                            <p className="mt-2 truncate text-[12.5px] font-bold">{s.approver_role === "supervisor" ? "Supervisor" : "Recursos Humanos"}</p>
                            <Badge tone={dec.tone} className="mt-0.5">
                              {dec.label}
                            </Badge>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  {r.decision_reason ? <p className="mt-4 rounded-[14px] bg-surface px-4 py-2.5 text-[13px] text-muted"><span className="font-bold text-foreground">Fundamento:</span> {r.decision_reason}</p> : null}
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
