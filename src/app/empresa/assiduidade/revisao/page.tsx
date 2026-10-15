"use client";

import { useState } from "react";
import { AttendanceNav } from "@/components/company/p1-attendance-nav";
import { LoadingRows } from "@/components/company/p1-shared";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { EventType } from "@/lib/domain/attendance-rules";
import { formatDateTime } from "@/lib/format";
import { EVENT_TYPE_LABEL, GEOFENCE_LABEL } from "@/lib/labels";
import { attempt, formObject } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

type Validation = { geofence_result: string; accuracy_m: number | string | null; distance_m: number | string | null; device_result: string };
type Row = {
  id: string;
  type: EventType;
  occurred_at: string;
  reason: string | null;
  employees: { full_name: string; employee_code: string } | null;
  attendance_stations: { name: string } | null;
  attendance_validations: Validation[] | null;
};

const GEO_TONE: Record<string, Tone> = { inside: "success", outside: "danger", inconclusive: "warning", unavailable: "warning" };
const DEVICE_LABEL: Record<string, string> = { trusted: "Dispositivo confiável", unknown: "Dispositivo desconhecido", revoked: "Dispositivo revogado", not_required: "" };

function Location({ v }: { v: Validation | undefined }) {
  if (!v) return <>—</>;
  const acc = v.accuracy_m != null ? Number(v.accuracy_m) : null;
  const dist = v.distance_m != null ? Number(v.distance_m) : null;
  return (
    <>
      <Badge tone={GEO_TONE[v.geofence_result] ?? "neutral"}>{GEOFENCE_LABEL[v.geofence_result] ?? v.geofence_result}</Badge>
      <span className="mt-1 block text-[12.5px] text-muted tabular">
        {acc ? `Precisão ±${Math.round(acc)} m` : "Sem precisão"}
        {dist ? `, a ${Math.round(dist)} m do centro` : ""}
      </span>
      {DEVICE_LABEL[v.device_result] && v.device_result !== "trusted" ? (
        <span className="mt-0.5 block text-[12.5px] font-bold text-warning">{DEVICE_LABEL[v.device_result]}</span>
      ) : null}
    </>
  );
}

export default function ReviewPage() {
  const { companyId, can, tz } = useCompany();
  const canReview = can("attendance.manage", "absence.decide.team");
  const list = useData(async () => {
    const res = await sb()
      .from("attendance_events")
      .select("id,type,occurred_at,reason,employees(full_name,employee_code),attendance_stations(name),attendance_validations(geofence_result,accuracy_m,distance_m,device_result)")
      .eq("company_id", companyId)
      .eq("status", "review")
      .order("occurred_at", { ascending: false })
      .limit(200);
    return must(res) as unknown as Row[];
  }, [companyId]);
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader title="Marcações em revisão" description="GPS inconclusivo, sem localização, dispositivo desconhecido ou revisão pedida pelo colaborador." />
      <PageBody>
        <AttendanceNav active="revisao" reviewCount={list.data ? rows.length : undefined} />
        <Notice tone="info">
          Uma marcação em revisão conta provisoriamente na assiduidade. Valide-a ou rejeite-a com fundamento; a decisão fica no trilho de auditoria.
          {!canReview ? " Apenas o RH ou a administração podem decidir." : ""}
        </Notice>
        {list.error ? (
          <Notice tone="danger">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nada por rever" description="Todas as marcações foram validadas." />
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background md:hidden">
              {rows.map((ev) => {
                const name = ev.employees?.full_name ?? "—";
                return (
                  <li key={ev.id} className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold">{name}</p>
                        <p className="text-[12.5px] text-muted tabular">
                          {EVENT_TYPE_LABEL[ev.type]}, {formatDateTime(ev.occurred_at, tz)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 text-[13px]">
                      <Location v={ev.attendance_validations?.[0]} />
                    </div>
                    {ev.attendance_stations?.name ? <p className="mt-2 text-[12.5px] text-muted">Estação: {ev.attendance_stations.name}</p> : null}
                    {ev.reason ? <p className="mt-2 text-[13px]">{ev.reason}</p> : null}
                    {canReview ? (
                      <div className="mt-3 flex justify-end">
                        <ReviewEvent eventId={ev.id} name={name} onDone={list.reload} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Colaborador</TH>
                    <TH>Marcação</TH>
                    <TH>Estação</TH>
                    <TH>Localização</TH>
                    <TH>Motivo</TH>
                    {canReview ? <TH /> : null}
                  </tr>
                </THead>
                <tbody>
                  {rows.map((ev) => {
                    const name = ev.employees?.full_name ?? "—";
                    return (
                      <TR key={ev.id}>
                        <TD>
                          <div className="flex items-center gap-3">
                            <Avatar name={name} size={30} />
                            <span className="text-[14px] font-bold">{name}</span>
                          </div>
                        </TD>
                        <TD>
                          <span className="block font-bold">{EVENT_TYPE_LABEL[ev.type]}</span>
                          <span className="block text-[12.5px] text-muted tabular">{formatDateTime(ev.occurred_at, tz)}</span>
                        </TD>
                        <TD className="text-muted">{ev.attendance_stations?.name ?? "—"}</TD>
                        <TD>
                          <Location v={ev.attendance_validations?.[0]} />
                        </TD>
                        <TD className="max-w-xs text-[12.5px] leading-snug text-muted">{ev.reason ?? "—"}</TD>
                        {canReview ? (
                          <TD className="text-right">
                            <ReviewEvent eventId={ev.id} name={name} onDone={list.reload} />
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </>
        )}
      </PageBody>
    </>
  );
}

function ReviewEvent({ eventId, name, onDone }: { eventId: string; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">
          Rever
        </Button>
      </DialogTrigger>
      <DialogContent title="Rever marcação" description={`${name}. GPS inconclusivo não é prova de fraude: confirme com o supervisor ou testemunhas.`}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              await rpc("ps_review_event", { p_event: eventId, p_decision: o.decision, p_reason: o.reason ?? "" });
              return o.decision === "accepted" ? "Marcação validada." : "Marcação rejeitada.";
            })
          }
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
          className="space-y-4"
        >
          <Field label="Decisão">
            <Select name="decision" defaultValue="accepted">
              <option value="accepted">Validar marcação</option>
              <option value="rejected">Rejeitar marcação</option>
            </Select>
          </Field>
          <Field label="Fundamento">
            <Textarea name="reason" required minLength={3} placeholder="Ex.: presença confirmada pelo supervisor no local." />
          </Field>
          <SubmitButton className="w-full">Confirmar decisão</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
