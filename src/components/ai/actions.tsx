"use client";

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { employeeReportHref } from "@/components/company/p2-shared";
import { Button } from "@/components/ui/button";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { cn } from "@/lib/utils";

/** Nome da Edge Function publicada no Supabase (no projecto actual chama-se "Ponto-ai"). */
export const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";
export const NOT_ACTIVE = `O assistente ainda não está activo. Publique a função '${AI_FUNCTION}' no Supabase.`;

/** Acção proposta pelo assistente; só acontece quando o utilizador confirma. */
export type AiAction = { type: string; label: string; args: Record<string, string>; state?: "done" | "skipped" };
export type AiReply = { reply: string; actions: AiAction[] };

export async function askAssistant(body: Record<string, unknown>): Promise<AiReply> {
  const { data, error } = await sb().functions.invoke(AI_FUNCTION, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response | undefined;
      if (res?.status === 404) throw new Error(NOT_ACTIVE);
      let detail: string | null = null;
      try {
        const j = (await res?.json()) as { error?: string; message?: string } | undefined;
        detail = j?.error ?? j?.message ?? null;
      } catch {}
      if (res?.status === 401 || res?.status === 403) throw new Error(detail ?? "Sem acesso ao assistente.");
      throw new Error(detail ?? "O assistente não conseguiu responder. Tente novamente.");
    }
    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      throw new Error(`${NOT_ACTIVE} Se já está publicada, verifique a ligação à internet.`);
    }
    throw new Error(errorMessage(error));
  }
  const d = (data ?? {}) as { reply?: string; error?: string; actions?: AiAction[] };
  if (d.error) throw new Error(d.error);
  if (!d.reply) throw new Error("O assistente não devolveu resposta.");
  return { reply: d.reply, actions: Array.isArray(d.actions) ? d.actions : [] };
}

async function firstId(table: "attendance_stations" | "work_locations", companyId: string) {
  const { data } = await sb().from(table).select("id").eq("company_id", companyId).eq("active", true).order("created_at").limit(1);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(table === "work_locations" ? "Crie primeiro um local de trabalho." : "Crie primeiro uma estação de marcação.");
  return id;
}

/** Executa a acção com a sessão do próprio utilizador (as permissões dele aplicam-se). */
async function execute(a: AiAction, companyId: string, go: (href: string) => void): Promise<string> {
  const g = a.args;
  switch (a.type) {
    case "decidir_justificacao":
      await rpc("ps_decide_absence", { p_request: g.id, p_decision: g.decisao === "aprovar" ? "approved" : "rejected", p_reason: g.fundamento });
      return g.decisao === "aprovar" ? "Justificação aprovada." : "Justificação recusada.";
    case "rever_marcacao":
      await rpc("ps_review_event", { p_event: g.id, p_decision: g.decisao === "aceitar" ? "accepted" : "rejected", p_reason: g.fundamento });
      return g.decisao === "aceitar" ? "Marcação aceite." : "Marcação rejeitada.";
    case "criar_marcacao_por_link": {
      // Para hoje usa o link de reserva do dia (já existe) e mostra o botão aos colaboradores.
      const daily = await rpc<{ id: string; date: string }[]>("ps_daily_links", { p_company: companyId }).catch(() => []);
      const today = daily.find((d) => d.date === g.dia);
      if (today) {
        await rpc("ps_daily_link_show", { p_link: today.id, p_shown: true });
        return "Link de reserva de hoje activado: os colaboradores já vêem o botão Marcar ponto.";
      }
      await rpc("ps_clock_link_save", {
        p_company: companyId,
        p_id: null,
        p_location: await firstId("work_locations", companyId),
        p_date: g.dia,
        p_start: g.das,
        p_end: g.as,
        p_note: g.motivo || null,
        p_require_gps: true,
      });
      return "Marcação por link criada.";
    }
    case "definir_horario_qr":
      await rpc("ps_station_set_window", { p_station: await firstId("attendance_stations", companyId), p_start: g.das ?? null, p_end: g.as ?? null });
      return "Horário do QR Code actualizado.";
    case "abrir_relatorio":
      go(employeeReportHref(g.id));
      return "";
    default:
      throw new Error("Acção desconhecida.");
  }
}

/** Lista de acções propostas, cada uma com Confirmar / Ignorar. */
export function AiActions({
  actions,
  companyId,
  onChange,
}: {
  actions: AiAction[];
  companyId: string;
  /** Chamado com o novo estado da lista (para guardar no histórico). */
  onChange?: (actions: AiAction[]) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);
  const [list, setList] = React.useState(actions);
  React.useEffect(() => {
    setList(actions);
  }, [actions]);

  const mark = (i: number, state: AiAction["state"]) => {
    const next = list.map((a, j) => (j === i ? { ...a, state } : a));
    setList(next);
    onChange?.(next);
  };

  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {list.map((a, i) => (
        <li key={i} className={cn("rounded-lg border bg-background px-3.5 py-3", a.state ? "border-border opacity-70" : "border-primary/40")}>
          <p className="text-[13.5px] leading-snug font-medium text-foreground">{a.label}</p>
          {a.state ? (
            <p className={cn("mt-1.5 text-[12.5px] font-bold", a.state === "done" ? "text-success" : "text-muted")}>
              {a.state === "done" ? "Feito" : "Ignorado"}
            </p>
          ) : (
            <div className="mt-2.5 flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(i);
                  try {
                    const msg = await execute(a, companyId, (href) => router.push(href));
                    if (msg) toast.success(msg);
                    mark(i, "done");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === i ? <span className="spinner" aria-hidden /> : null}
                {a.type === "abrir_relatorio" ? "Abrir" : "Confirmar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => mark(i, "skipped")}>
                Ignorar
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
