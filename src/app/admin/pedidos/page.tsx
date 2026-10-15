"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CompanyDialog } from "@/components/admin/company-form";
import { loadOverview, REQUEST_STATUS, type AdminRequest } from "@/components/admin/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime, formatNumber } from "@/lib/format";
import { attempt, formObject } from "@/lib/result";
import { rpc } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";

type Filter = "pending" | "approved" | "rejected";

export default function RequestsPage() {
  const { data, error, loading, reload } = useData(loadOverview, []);
  const [filter, setFilter] = React.useState<Filter>("pending");
  const [approving, setApproving] = React.useState<AdminRequest | null>(null);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejecting, setRejecting] = React.useState<AdminRequest | null>(null);

  const requests = data?.requests ?? [];
  const rows = requests.filter((r) => r.status === filter);
  const companyName = (id: string | null) => data?.companies.find((c) => c.id === id)?.name;

  return (
    <>
      <PageHeader title="Pedidos de conta" description="Recebidos pela página pública. Ao aprovar, cria a empresa e o acesso do responsável." />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Tabs
          items={(
            [
              ["pending", "Pendentes"],
              ["approved", "Aprovados"],
              ["rejected", "Recusados"],
            ] as [Filter, string][]
          ).map(([key, label]) => ({ key, label, count: data ? requests.filter((r) => r.status === key).length : undefined }))}
          active={filter}
          onChange={setFilter}
        />

        {loading && !data ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={filter === "pending" ? "Sem pedidos por tratar" : filter === "approved" ? "Nenhum pedido aprovado" : "Nenhum pedido recusado"}
            description={filter === "pending" ? "Os pedidos feitos em “Pedir conta” aparecem aqui." : undefined}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const st = REQUEST_STATUS[r.status];
              const [message, reason] = splitReason(r.message);
              return (
                <article key={r.id} className="flex flex-col rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{r.company_name}</p>
                      <p className="text-xs break-words text-muted">
                        {r.contact_name} · {r.email}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </p>
                    </div>
                    {r.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>
                          Recusar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setApproving(r);
                            setApproveOpen(true);
                          }}
                        >
                          Aprovar
                        </Button>
                      </div>
                    ) : (
                      <Badge tone={st.tone}>{st.label}</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {[
                      r.city,
                      r.nuit ? `NUIT ${r.nuit}` : null,
                      r.employees_estimate ? `${formatNumber(r.employees_estimate)} colaboradores` : null,
                      r.plan ? `Plano ${r.plan}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Sem mais detalhes"}
                  </p>
                  {message ? <p className="mt-2 rounded-md bg-surface px-3 py-2 text-[13px] whitespace-pre-line">{message}</p> : null}
                  {reason !== null ? (
                    <p className="mt-2 text-[13px] text-muted">
                      <span className="font-medium text-foreground">Motivo da recusa:</span> {reason || "—"}
                    </p>
                  ) : null}
                  <p className="mt-auto pt-3 text-[11px] text-subtle">
                    Recebido {formatDateTime(r.created_at)}
                    {r.decided_at ? ` · ${r.status === "approved" ? "aprovado" : "recusado"} ${formatDateTime(r.decided_at)}` : ""}
                    {r.status === "approved" && r.company_id ? (
                      <>
                        {" · "}
                        <Link href="/admin/empresas/" className="font-medium text-primary">
                          {companyName(r.company_id) ?? "ver empresa"}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </PageBody>

      {data ? (
        <CompanyDialog
          open={approveOpen}
          onOpenChange={(o) => {
            setApproveOpen(o);
            if (!o) setApproving(null);
          }}
          plans={data.plans}
          request={approving}
          onCreated={reload}
        />
      ) : null}
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={reload} />
    </>
  );
}

/** A recusa acrescenta "[Recusado] motivo" à mensagem original (ps_admin_reject_request). */
function splitReason(message: string | null): [string, string | null] {
  if (!message) return ["", null];
  const i = message.lastIndexOf("[Recusado]");
  if (i < 0) return [message.trim(), null];
  return [message.slice(0, i).trim(), message.slice(i + "[Recusado]".length).trim()];
}

function RejectDialog({ request, onClose, onDone }: { request: AdminRequest | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      {request ? (
        <DialogContent title={`Recusar pedido — ${request.company_name}`} description="O pedido fica registado como recusado. Não é enviado qualquer aviso automático.">
          <ActionForm
            action={(_, fd) =>
              attempt(async () => {
                const { reason } = formObject(fd);
                await rpc("ps_admin_reject_request", { p_request: request.id, p_reason: reason ?? "" });
                return "Pedido recusado.";
              })
            }
            onSuccess={() => {
              onClose();
              onDone();
            }}
            className="space-y-4"
          >
            <Field label="Motivo (opcional)" hint="Fica registado no pedido e na auditoria.">
              <Textarea name="reason" maxLength={500} placeholder="Ex.: dados incompletos, empresa duplicada…" />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <SubmitButton variant="danger" pendingText="A recusar…">
                Recusar pedido
              </SubmitButton>
            </div>
          </ActionForm>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
