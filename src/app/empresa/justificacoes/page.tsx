"use client";

import { FileCheck2, Paperclip } from "lucide-react";
import { useState } from "react";
import { ABSENCE_TYPES, LoadingRows, openSignedFile } from "@/components/company/p1-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      <PageHeader title="Justificações" description="Pedido do colaborador → análise do supervisor/RH → decisão fundamentada → recálculo da assiduidade." />
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
          <EmptyState icon={<FileCheck2 />} title={view === "pendentes" ? "Sem justificações por decidir" : "Sem decisões registadas"} />
        ) : (
          <div className={`grid gap-3 xl:grid-cols-2 ${list.loading ? "opacity-60 transition-opacity" : ""}`}>
            {requests.map((r) => {
              const name = r.employees?.full_name ?? "—";
              const steps = [...(r.approval_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
              const current = steps.find((s) => s.decision === "pending");
              const canDecide = r.status === "pending" && r.employees?.user_id !== me.id && (isHr || current?.approver_role === "supervisor");
              const st = ABSENCE_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const nDays = daysBetween(r.start_date, r.end_date).length;
              const docs = r.absence_documents ?? [];
              return (
                <Card key={r.id} className="flex flex-col p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{name}</p>
                      <p className="truncate text-xs text-muted">
                        {r.employees?.job_title ?? "—"} · {r.employees?.departments?.name ?? "Sem departamento"}
                      </p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface/70 px-4 py-3 text-[13px]">
                    <div>
                      <p className="text-xs text-muted">Tipo</p>
                      <p className="font-medium">{ABSENCE_TYPES[r.type] ?? r.type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Período</p>
                      <p className="font-medium tabular">
                        {r.start_date === r.end_date ? formatDate(r.start_date, tz) : `${formatDate(r.start_date, tz)} – ${formatDate(r.end_date, tz)}`}
                        <span className="text-muted">
                          {" "}
                          ({nDays} {nDays === 1 ? "dia" : "dias"})
                        </span>
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed break-words">{r.reason}</p>
                  {docs.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {docs.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => void openSignedFile("justificacoes", d.storage_key)}
                          className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface"
                        >
                          <Paperclip className="size-3.5 shrink-0" /> <span className="truncate">{d.file_name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-subtle">Sem anexos.</p>
                  )}
                  <ol className="mt-4 space-y-1.5 border-t border-border pt-3">
                    {steps.map((s) => {
                      const d = STEP_DECISION[s.decision] ?? { label: s.decision, tone: "neutral" as const };
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="w-28 text-muted">{s.approver_role === "supervisor" ? "Supervisor" : "Recursos Humanos"}</span>
                          <Badge tone={d.tone}>{d.label}</Badge>
                          {s.users?.name ? <span className="text-muted">por {s.users.name}</span> : null}
                          {s.reason && s.decision !== "pending" ? <span className="w-full text-muted sm:w-auto">“{s.reason}”</span> : null}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-xs text-subtle">
                      {r.status === "pending" || !r.decided_at ? `Submetido ${formatDateTime(r.created_at, tz)}` : `Decidido ${formatDateTime(r.decided_at, tz)}`}
                    </span>
                    {canDecide ? <DecideAbsence requestId={r.id} name={name} onDone={list.reload} /> : null}
                    {r.status === "pending" && !canDecide && current?.approver_role === "hr" && !isHr ? (
                      <span className="text-xs text-muted">Aguarda o RH</span>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
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
                className={`h-11 cursor-pointer rounded-md border text-[13px] font-medium ${
                  decision === d
                    ? d === "approved"
                      ? "border-success bg-success-soft text-success"
                      : "border-danger bg-danger-soft text-danger"
                    : "border-border-strong text-muted"
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
