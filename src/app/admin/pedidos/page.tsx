"use client";

import Link from "next/link";
import * as React from "react";
import { CompanyDialog } from "@/components/admin/company-form";
import { loadOverview, REQUEST_STATUS, type AdminRequest } from "@/components/admin/data";
import { mailto } from "@/components/admin/credentials";
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
      <PageHeader title="Pedidos de acesso" description="1. Peça os dados por email. 2. Com a resposta, crie a conta. 3. Envie as credenciais para o mesmo email." />
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
          <Skeleton className="h-80 rounded-xl" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === "pending" ? "Sem pedidos por tratar" : filter === "approved" ? "Nenhum pedido aprovado" : "Nenhum pedido recusado"}
            description={filter === "pending" ? "Os pedidos feitos na página pública “Pedir acesso” aparecem aqui." : undefined}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {rows.map((r) => {
              const st = REQUEST_STATUS[r.status];
              const [message, reason] = splitReason(r.message);
              const facts = [
                ["Cidade", r.city],
                ["NUIT", r.nuit],
                ["Colaboradores", r.employees_estimate ? formatNumber(r.employees_estimate) : null],
              ].filter((f): f is [string, string] => !!f[1]);
              return (
                <li key={r.id} className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-[17px] font-bold tracking-[-0.01em]">{r.company_name}</h2>
                      {r.status === "pending" ? null : <Badge tone={st.tone}>{st.label}</Badge>}
                    </div>
                    <p className="mt-1 text-[13.5px] break-words">
                      {r.contact_name ? <span className="font-bold">{r.contact_name}, </span> : null}
                      <a href={`mailto:${r.email}`} className="text-muted underline decoration-border-strong underline-offset-4 hover:text-foreground">
                        {r.email}
                      </a>
                      {r.phone ? <span className="text-muted tabular">, {r.phone}</span> : null}
                    </p>

                    {facts.length ? (
                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        {facts.map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-[12px] text-muted">{k}</dt>
                            <dd className="text-[13.5px] font-bold tabular">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    {message ? (
                      <p className="mt-3 max-w-2xl border-l-4 border-border-strong pl-3 text-[13.5px] leading-relaxed whitespace-pre-line">{message}</p>
                    ) : null}
                    {reason !== null ? (
                      <p className="mt-3 text-[13px] text-muted">
                        <span className="font-bold text-foreground">Motivo da recusa:</span> {reason || "não indicado"}
                      </p>
                    ) : null}

                    <p className="mt-3 text-[12px] text-subtle">
                      Recebido {formatDateTime(r.created_at)}
                      {r.decided_at ? `, ${r.status === "approved" ? "aprovado" : "recusado"} ${formatDateTime(r.decided_at)}` : ""}
                      {r.status === "approved" && r.company_id ? (
                        <>
                          {". "}
                          <Link href="/admin/empresas/" className="font-bold text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary">
                            {companyName(r.company_id) ?? "Ver empresa"}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
                      <Button size="sm" variant="outline" asChild>
                        <a href={askDetailsMail(r)}>Pedir dados por email</a>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setApproving(r);
                          setApproveOpen(true);
                        }}
                      >
                        Criar conta
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>
                        Recusar
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>

      {data ? (
        <CompanyDialog
          open={approveOpen}
          onOpenChange={(o) => {
            setApproveOpen(o);
            if (!o) setApproving(null);
          }}
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
        <DialogContent title={`Recusar o pedido de ${request.company_name}`} description="O pedido fica registado como recusado. Não é enviado qualquer aviso automático.">
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
              <Textarea name="reason" maxLength={500} placeholder="Ex.: dados incompletos ou empresa duplicada" />
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

/** Resposta ao pedido: pede ao responsável os dados que faltam para criar a conta. */
function askDetailsMail(r: AdminRequest) {
  return mailto(
    r.email,
    `Horbit: pedido de acesso da ${r.company_name}`,
    `Olá,\n\nRecebemos o pedido de acesso da ${r.company_name} ao Horbit. Para criarmos a conta, responda a este email com:\n\n- Nome completo do responsável:\n- Telefone:\n- NUIT da empresa:\n- Cidade:\n- Número aproximado de colaboradores:\n- Utilizador que prefere para entrar (opcional):\n\nDepois de criarmos a conta, enviamos para este email o utilizador e a palavra-passe do responsável.\n\nCumprimentos,\nEquipa Horbit`,
  );
}
