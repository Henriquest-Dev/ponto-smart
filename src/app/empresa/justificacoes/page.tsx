"use client";

import { useState } from "react";
import { ABSENCE_TYPES, LoadingRows, openSignedFile } from "@/components/company/p1-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/input";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatDateTime } from "@/lib/format";
import { ABSENCE_STATUS, STEP_DECISION } from "@/lib/labels";
import { attempt, formObject } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { daysBetween } from "@/lib/time";

type View = "pendentes" | "decididas";

type Step = { id: string; step_order: number; approver_role: string; decision: string; reason: string | null; decided_at: string | null; users: { name: string } | null };
type Doc = { id: string; file_name: string; storage_key: string; mime_type: string };
type Request = {
  id: string;
  start_date: string;
  end_date: string;
  type: string;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  employees: { full_name: string; job_title: string | null; user_id: string | null; departments: { name: string } | null } | null;
  approval_steps: Step[] | null;
  absence_documents: Doc[] | null;
};

const SELECT =
  "id,start_date,end_date,type,reason,status,created_at,decided_at,decision_reason," +
  "employees(full_name,job_title,user_id,departments(name))," +
  "approval_steps(id,step_order,approver_role,decision,reason,decided_at,users(name))," +
  "absence_documents(id,file_name,storage_key,mime_type)";

export default function CompanyAbsences() {
  const { companyId, can, me, tz } = useCompany();
  const [view, setView] = useState<View>("pendentes");
  const isHr = can("absence.decide");

  const list = useData(async () => {
    let qb = sb().from("absence_requests").select(SELECT).eq("company_id", companyId);
    qb =
      view === "pendentes"
        ? qb.eq("status", "pending").order("created_at", { ascending: true })
        : qb.in("status", ["approved", "rejected", "cancelled"]).order("decided_at", { ascending: false, nullsFirst: false });
    const [rows, pending] = await Promise.all([
      qb.limit(100),
      sb().from("absence_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending"),
    ]);
    return { rows: must(rows) as unknown as Request[], pending: pending.count ?? 0 };
  }, [companyId, view]);

  const requests = list.data?.rows ?? [];

  return (
    <>
      <PageHeader title="Justificações" description="O colaborador pede, o supervisor ou o RH analisa e decide com fundamento, e a assiduidade é recalculada." />
      <PageBody>
        <Tabs
          active={view}
          onChange={setView}
          items={[
            { key: "pendentes", label: "Por decidir", count: list.data?.pending },
            { key: "decididas", label: "Decididas" },
          ]}
        />
        {!can("absence.decide", "absence.decide.team") ? (
          <Notice tone="warning">Sem permissão para decidir justificações.</Notice>
        ) : list.error ? (
          <Notice tone="danger">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <LoadingRows rows={3} />
        ) : requests.length === 0 ? (
          <EmptyState title={view === "pendentes" ? "Sem justificações por decidir" : "Sem decisões registadas"} />
        ) : (
          <ul
            className={`divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background ${list.loading ? "opacity-60 transition-opacity" : ""}`}
          >
            {requests.map((r) => {
              const name = r.employees?.full_name ?? "—";
              const steps = [...(r.approval_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
              const current = steps.find((s) => s.decision === "pending");
              const canDecide = r.status === "pending" && r.employees?.user_id !== me.id && (isHr || current?.approver_role === "supervisor");
              const st = ABSENCE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const nDays = daysBetween(r.start_date, r.end_date).length;
              const docs = r.absence_documents ?? [];
              return (
                <li key={r.id} className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-10">
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      <Avatar name={name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-extrabold tracking-[-0.01em]">{name}</p>
                        <p className="truncate text-[12.5px] text-muted">
                          {[r.employees?.job_title, r.employees?.departments?.name ?? "Sem departamento"].filter(Boolean).join(", ")}
                        </p>
                      </div>
                      <Badge tone={st.tone} className="lg:hidden">
                        {st.label}
                      </Badge>
                    </div>
                    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                      <div>
                        <dt className="text-[12px] text-muted">Tipo</dt>
                        <dd className="mt-0.5 text-[14px] font-bold">{ABSENCE_TYPES[r.type] ?? r.type}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-muted">Período</dt>
                        <dd className="mt-0.5 text-[14px] font-bold tabular">
                          {r.start_date === r.end_date ? formatDate(r.start_date, tz) : `${formatDate(r.start_date, tz)} a ${formatDate(r.end_date, tz)}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-muted">Duração</dt>
                        <dd className="mt-0.5 text-[14px] font-extrabold tabular">
                          {nDays} {nDays === 1 ? "dia" : "dias"}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 border-l-[3px] border-border-strong pl-3 text-[13.5px] leading-relaxed break-words">{r.reason}</p>
                    {docs.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {docs.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => void openSignedFile("justificacoes", d.storage_key)}
                            className="inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-full bg-surface-2 px-4 text-[12.5px] font-bold hover:bg-primary-soft hover:text-primary"
                            title={`Abrir ${d.file_name}`}
                          >
                            <span className="truncate">{d.file_name}</span>
                            <span className="shrink-0 text-primary">Abrir</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-[12.5px] text-subtle">Sem anexos.</p>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-border lg:pl-10">
                    <Badge tone={st.tone} className="hidden text-[13.5px] lg:inline-flex">
                      {st.label}
                    </Badge>
                    <ol className="space-y-3">
                      {steps.map((s) => {
                        const d = STEP_DECISION[s.decision] ?? { label: s.decision, tone: "neutral" as const };
                        return (
                          <li key={s.id} className="text-[13px]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold">{s.approver_role === "supervisor" ? "Supervisor" : "Recursos humanos"}</span>
                              <Badge tone={d.tone}>{d.label}</Badge>
                            </div>
                            {s.users?.name ? <p className="text-[12.5px] text-muted">Por {s.users.name}</p> : null}
                            {s.reason && s.decision !== "pending" ? <p className="mt-0.5 text-[12.5px] text-muted">“{s.reason}”</p> : null}
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                      <span className="text-[12px] text-subtle">
                        {r.status === "pending" || !r.decided_at ? `Submetido ${formatDateTime(r.created_at, tz)}` : `Decidido ${formatDateTime(r.decided_at, tz)}`}
                      </span>
                      {canDecide ? <DecideAbsence requestId={r.id} name={name} onDone={list.reload} /> : null}
                      {r.status === "pending" && !canDecide && current?.approver_role === "hr" && !isHr ? (
                        <span className="text-[12.5px] font-bold text-muted">Aguarda o RH</span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function DecideAbsence({ requestId, name, onDone }: { requestId: string; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Decidir</Button>
      </DialogTrigger>
      <DialogContent title="Decidir justificação" description={`${name}. A decisão deve ser fundamentada e é comunicada ao colaborador.`}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              const r = await rpc<string>("ps_decide_absence", { p_request: requestId, p_decision: o.decision, p_reason: o.reason ?? "" });
              if (r === "step_approved") return "Validada pelo supervisor. Segue para decisão do RH.";
              return r === "approved" ? "Decisão registada: aprovada." : "Decisão registada: recusada.";
            })
          }
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
          className="space-y-4"
        >
          <input type="hidden" name="decision" value={decision} />
          <div className="grid grid-cols-2 gap-2">
            {(["approved", "rejected"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecision(d)}
                aria-pressed={decision === d}
                className={`h-11 cursor-pointer rounded-full border-2 text-[14px] font-bold transition-colors ${
                  decision === d
                    ? d === "approved"
                      ? "border-success bg-success-soft text-success"
                      : "border-danger bg-danger-soft text-danger"
                    : "border-border-strong text-muted hover:border-foreground hover:text-foreground"
                }`}
              >
                {d === "approved" ? "Aprovar" : "Recusar"}
              </button>
            ))}
          </div>
          <Field label="Fundamento">
            <Textarea
              name="reason"
              required
              minLength={3}
              placeholder={decision === "approved" ? "Ex.: atestado médico verificado." : "Ex.: documento não corresponde às datas indicadas."}
            />
          </Field>
          <SubmitButton className="w-full" variant={decision === "approved" ? "primary" : "danger"}>
            Confirmar {decision === "approved" ? "aprovação" : "recusa"}
          </SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
