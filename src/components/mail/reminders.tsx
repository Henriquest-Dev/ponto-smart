"use client";

import { Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { errorMessage, rpc } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";
import { localDateTimeInput } from "@/lib/time";
import { cn } from "@/lib/utils";

type Reminder = {
  id: string;
  title: string;
  message: string;
  recipients: string[];
  nextAt: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  active: boolean;
  sentCount: number;
  lastSentAt: string | null;
  lastError: string | null;
  by: string | null;
};
const REPEAT: Record<Reminder["repeat"], string> = { none: "Uma vez", daily: "Todos os dias", weekly: "Todas as semanas", monthly: "Todos os meses" };

/** Lembretes e agendamentos por email (da empresa ou, sem companyId, do Super Admin). O Orbi também os cria. */
export function RemindersCard({ companyId, tz = "Africa/Maputo" }: { companyId: string | null; tz?: string }) {
  const list = useData(
    () =>
      rpc<Reminder[]>("ps_reminders", { p_company: companyId }).catch((e) => {
        if (/ps_reminders|função em falta|schema cache/i.test(errorMessage(e))) return null;
        throw e;
      }),
    [companyId],
  );
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (list.data === null) return null;
  const fmt = (d: string) => new Intl.DateTimeFormat("pt-PT", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));

  const save = async (fd: FormData) => {
    setBusy(true);
    try {
      await rpc("ps_reminder_save", {
        p_company: companyId,
        p: {
          title: String(fd.get("title") ?? ""),
          message: String(fd.get("message") ?? ""),
          when: String(fd.get("when") ?? ""),
          repeat: String(fd.get("repeat") ?? "none"),
          recipients: String(fd.get("to") ?? "")
            .split(/[,;\s]+/)
            .filter((e) => e.includes("@")),
        },
      });
      toast.success("Lembrete criado: chega por email à hora marcada.");
      setAdding(false);
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: Reminder) => {
    if (!window.confirm(`Apagar o lembrete "${r.title}"?`)) return;
    try {
      await rpc("ps_reminder_delete", { p_id: r.id });
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Lembretes e agendamentos</CardTitle>
          <CardDescription>Chegam por email à hora marcada, sozinhos. Também pode pedir ao Orbi: &quot;lembra-me todos os dias 25 de pagar os salários&quot;.</CardDescription>
        </div>
        <Button size="sm" variant={adding ? "ghost" : "soft"} onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancelar" : "Novo lembrete"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding ? (
          <form
            className="space-y-3 rounded-xl border border-primary/40 bg-primary-soft/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save(new FormData(e.currentTarget));
            }}
          >
            <Field label="Título" htmlFor="rem-title"><Input id="rem-title" name="title" required placeholder="Ex.: Pagar os salários" /></Field>
            <Field label="Mensagem (opcional)" htmlFor="rem-msg"><Textarea id="rem-msg" name="message" className="min-h-16" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quando" htmlFor="rem-when">
                <Input id="rem-when" name="when" type="datetime-local" required defaultValue={localDateTimeInput(new Date(Date.now() + 3600_000), tz)} />
              </Field>
              <Field label="Repetir" htmlFor="rem-rep">
                <Select id="rem-rep" name="repeat" defaultValue="none">
                  {Object.entries(REPEAT).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Para (opcional)" hint={companyId ? "Vazio = email da empresa e dos responsáveis." : "Vazio = email do Horbit."} htmlFor="rem-to">
              <Input id="rem-to" name="to" placeholder="email@exemplo.com" />
            </Field>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden /> : null} Criar lembrete
            </Button>
          </form>
        ) : null}
        {list.error ? <p className="text-[13px] text-danger">{list.error}</p> : null}
        {list.data?.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {list.data.map((r) => (
              <li key={r.id} className={cn("flex items-start gap-3 px-3 py-2.5", !r.active && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{r.title}</p>
                  <p className="text-[12.5px] text-muted">
                    {r.active ? `${REPEAT[r.repeat]} · próximo a ${fmt(r.nextAt)}` : `Enviado a ${r.lastSentAt ? fmt(r.lastSentAt) : "—"}`}
                    {r.recipients.length ? ` · para ${r.recipients.join(", ")}` : ""}
                  </p>
                  {r.lastError ? <p className="text-[12px] text-danger">Último envio falhou: {r.lastError}</p> : null}
                </div>
                <button type="button" aria-label={`Apagar ${r.title}`} onClick={() => void remove(r)} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger">
                  <Trash className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : list.data && !adding ? (
          <p className="rounded-xl bg-surface px-3 py-2.5 text-[13px] text-muted">Ainda não há lembretes.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
