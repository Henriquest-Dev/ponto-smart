"use client";

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { generatePassword, suggestLogin } from "@/components/company/p1-shared";
import { employeeReportHref, todayIn } from "@/components/company/p2-shared";
import { exportAttendance, exportEmployees } from "@/components/company/p2-reports";
import { Button } from "@/components/ui/button";
import { errorMessage, must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { cn } from "@/lib/utils";

/** Nome da Edge Function publicada no Supabase (no projecto actual chama-se "Ponto-ai"). */
export const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";
export const NOT_ACTIVE = `O assistente ainda não está activo. Publique a função '${AI_FUNCTION}' no Supabase.`;

/** Acção proposta pelo assistente; só acontece quando o utilizador confirma (botão ou voz). */
export type AiAction = { type: string; label: string; args: Record<string, unknown>; state?: "done" | "skipped" };
export type AiReply = { reply: string; actions: AiAction[] };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
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
  const d = (data ?? {}) as T & { error?: string };
  if (d.error) throw new Error(d.error);
  return d;
}

export async function askAssistant(body: Record<string, unknown>): Promise<AiReply> {
  const d = await invoke<{ reply?: string; actions?: AiAction[] }>(body);
  if (!d.reply) throw new Error("O assistente não devolveu resposta.");
  return { reply: d.reply, actions: Array.isArray(d.actions) ? d.actions : [] };
}

const PAGES: Record<string, string> = {
  painel: "/empresa/",
  colaboradores: "/empresa/colaboradores/",
  assiduidade: "/empresa/assiduidade/",
  revisao: "/empresa/assiduidade/revisao/",
  justificacoes: "/empresa/justificacoes/",
  horarios: "/empresa/horarios/",
  relatorios: "/empresa/relatorios/",
  salarios: "/empresa/salarios/",
  qr: "/empresa/qr/",
  locais: "/empresa/locais/",
  auditoria: "/empresa/auditoria/",
  definicoes: "/empresa/definicoes/",
};

/** Resultado que fica visível por baixo da acção (credenciais nunca são guardadas no histórico). */
type Outcome = { message: string; credentials?: { name: string; login: string; password: string }; mailto?: string };
type Env = { companyId: string; companyName: string; tz: string; canSalary: boolean; go: (href: string) => void };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

async function firstId(table: "attendance_stations" | "work_locations", companyId: string) {
  const { data } = await sb().from(table).select("id").eq("company_id", companyId).eq("active", true).order("created_at").limit(1);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(table === "work_locations" ? "Crie primeiro um local de trabalho." : "Crie primeiro uma estação de marcação.");
  return id;
}

async function idByName(table: "departments" | "branches" | "work_schedules", companyId: string, name: unknown) {
  if (!s(name)) return null;
  const { data } = await sb().from(table).select("id,name").eq("company_id", companyId);
  const row = ((data ?? []) as { id: string; name: string }[]).find((r) => r.name.toLowerCase() === s(name).toLowerCase());
  if (!row) throw new Error(`Não encontrei "${s(name)}" na empresa.`);
  return row.id;
}

async function employee(id: unknown) {
  const { data } = await sb().from("employees").select("id,full_name,user_id,status").eq("id", s(id)).maybeSingle();
  if (!data) throw new Error("Colaborador não encontrado ou sem permissão para o ver.");
  return data as { id: string; full_name: string; user_id: string | null; status: string };
}

/** Próximo nº mecanográfico livre: mantém o prefixo mais usado (ex.: L07 → L08). */
async function nextCode(companyId: string) {
  const { data } = await sb().from("employees").select("employee_code").eq("company_id", companyId);
  const codes = ((data ?? []) as { employee_code: string }[]).map((r) => r.employee_code);
  let best = { prefix: "C", n: 0, width: 3 };
  for (const c of codes) {
    const m = /^(.*?)(\d+)$/.exec(c);
    if (m && Number(m[2]) >= best.n) best = { prefix: m[1], n: Number(m[2]), width: m[2].length };
  }
  for (let n = best.n + 1; ; n++) {
    const code = `${best.prefix}${String(n).padStart(best.width, "0")}`;
    if (!codes.includes(code)) return code;
  }
}

/** Cria ou altera o acesso; se o utilizador sugerido já existir, tenta com um número no fim. */
async function setAccess(employeeId: string, login: string, password: string | null, role: string) {
  const base = login || "colaborador";
  for (let i = 0; i < 4; i++) {
    const tryLogin = i === 0 ? base : `${base}${i + 1}`;
    try {
      await rpc("ps_set_access", { p_employee: employeeId, p_login: tryLogin, p_password: password, p_role: role });
      return tryLogin;
    } catch (e) {
      if (i < 3 && /exist|utilizador|duplicate|já/i.test(errorMessage(e))) continue;
      throw e;
    }
  }
  throw new Error("Não foi possível criar o utilizador.");
}

/** Executa a acção com a sessão do próprio utilizador (as permissões dele aplicam-se). */
async function execute(a: AiAction, env: Env): Promise<Outcome> {
  const g = a.args;
  const today = todayIn(env.tz);
  switch (a.type) {
    case "decidir_justificacao":
      await rpc("ps_decide_absence", { p_request: g.id, p_decision: g.decisao === "aprovar" ? "approved" : "rejected", p_reason: g.fundamento });
      return { message: g.decisao === "aprovar" ? "Justificação aprovada." : "Justificação recusada." };
    case "rever_marcacao":
      await rpc("ps_review_event", { p_event: g.id, p_decision: g.decisao === "aceitar" ? "accepted" : "rejected", p_reason: g.fundamento });
      return { message: g.decisao === "aceitar" ? "Marcação aceite." : "Marcação rejeitada." };
    case "criar_marcacao_por_link": {
      // Para hoje usa o link de reserva do dia (já existe) e mostra o botão aos colaboradores.
      const daily = await rpc<{ id: string; date: string }[]>("ps_daily_links", { p_company: env.companyId }).catch(() => []);
      const todays = daily.find((d) => d.date === g.dia);
      if (todays) {
        await rpc("ps_daily_link_show", { p_link: todays.id, p_shown: true });
        return { message: "Link de reserva de hoje activado: os colaboradores já vêem o botão Marcar ponto." };
      }
      await rpc("ps_clock_link_save", {
        p_company: env.companyId,
        p_id: null,
        p_location: await firstId("work_locations", env.companyId),
        p_date: g.dia,
        p_start: g.das,
        p_end: g.as,
        p_note: s(g.motivo) || null,
        p_require_gps: true,
      });
      return { message: "Marcação por link criada." };
    }
    case "definir_horario_qr":
      await rpc("ps_station_set_window", { p_station: await firstId("attendance_stations", env.companyId), p_start: g.das ?? null, p_end: g.as ?? null });
      return { message: "Horário do QR Code actualizado." };
    case "abrir_relatorio":
      env.go(employeeReportHref(s(g.id)));
      return { message: "" };
    case "abrir_pagina":
      env.go(PAGES[s(g.pagina)] ?? "/empresa/");
      return { message: "" };
    case "exportar_planilha":
      if (g.tipo === "colaboradores") {
        const n = await exportEmployees(env.companyId, env.companyName, env.canSalary, today);
        return { message: `Planilha descarregada com ${n} colaboradores.` };
      }
      await exportAttendance(env.companyId, env.companyName, s(g.mes) || today.slice(0, 7), env.tz);
      return { message: "Planilha da assiduidade descarregada." };
    case "avisar_responsavel": {
      const r = await invoke<{ notified: number; emails: string[]; sent: number; emailConfigured: boolean; emailError: string | null }>({
        scope: "company",
        companyId: env.companyId,
        mode: "notify",
        subject: g.assunto,
        message: g.mensagem,
      });
      const mailto = r.emails.length ? `mailto:${r.emails.join(",")}?subject=${encodeURIComponent(`[Horbit] ${s(g.assunto)}`)}&body=${encodeURIComponent(s(g.mensagem))}` : undefined;
      if (r.sent) return { message: `Aviso enviado: notificação no Horbit e email para ${r.emails.join(", ")}.` };
      return {
        message: r.emailError
          ? `Notificação enviada no Horbit. ${r.emailError}`
          : !r.emails.length
            ? "Notificação enviada no Horbit. A empresa não tem email registado para enviar por email."
            : "Notificação enviada no Horbit. O envio automático de email ainda não está configurado: use o botão para enviar pelo seu email.",
        mailto: r.sent ? undefined : mailto,
      };
    }
    case "cessar_colaborador": {
      const e = await employee(g.id);
      must(await sb().from("employees").update({ status: "terminated" }).eq("id", e.id).select("id"));
      if (e.user_id) await rpc("ps_remove_access", { p_employee: e.id });
      return { message: `${e.full_name} ficou com o contrato cessado e sem acesso ao Horbit.` };
    }
    case "reactivar_colaborador": {
      const e = await employee(g.id);
      must(await sb().from("employees").update({ status: "active" }).eq("id", e.id).select("id"));
      return { message: `${e.full_name} voltou a activo.${e.user_id ? "" : " Para entrar no Horbit precisa de acesso."}` };
    }
    case "editar_colaborador": {
      const patch: Record<string, unknown> = {};
      const map: Record<string, string> = { nome: "full_name", numero: "employee_code", funcao: "job_title", email: "email", telefone: "phone", nuit: "nuit", admissao: "hire_date" };
      for (const [k, col] of Object.entries(map)) if (s(g[k])) patch[col] = k === "email" ? s(g[k]).toLowerCase() : s(g[k]);
      if (s(g.departamento)) patch.department_id = await idByName("departments", env.companyId, g.departamento);
      if (s(g.filial)) patch.branch_id = await idByName("branches", env.companyId, g.filial);
      if (g.estado === "activo" || g.estado === "inactivo") patch.status = g.estado === "activo" ? "active" : "inactive";
      const rows = must(await sb().from("employees").update(patch).eq("id", s(g.id)).select("id"));
      if (!rows?.length) throw new Error("Sem permissão para editar este colaborador.");
      return { message: "Ficha actualizada." };
    }
    case "criar_colaborador": {
      const name = s(g.nome);
      const p: Record<string, string> = { fullName: name, employeeCode: s(g.numero) || (await nextCode(env.companyId)) };
      if (s(g.funcao)) p.jobTitle = s(g.funcao);
      if (s(g.email)) p.email = s(g.email);
      if (s(g.telefone)) p.phone = s(g.telefone);
      if (s(g.admissao)) p.hireDate = s(g.admissao);
      const dep = await idByName("departments", env.companyId, g.departamento);
      if (dep) p.departmentId = dep;
      const branch = await idByName("branches", env.companyId, g.filial);
      if (branch) p.branchId = branch;
      const sched = await idByName("work_schedules", env.companyId, g.horario);
      if (sched) p.scheduleId = sched;
      if (Number(g.salario) > 0) p.salary = String(g.salario);
      const id = await rpc<string>("ps_create_employee", { p_company: env.companyId, p });
      if (!g.acesso) return { message: `${name} criado com o nº ${p.employeeCode}.` };
      const password = generatePassword();
      const login = await setAccess(id, suggestLogin(name), password, s(g.papel) || "employee");
      return { message: `${name} criado com o nº ${p.employeeCode} e com acesso ao Horbit.`, credentials: { name, login, password } };
    }
    case "dar_acesso": {
      const e = await employee(g.id);
      const role = s(g.papel) || "employee";
      // Já tem acesso: só muda o papel (mantém utilizador e palavra-passe).
      if (g.mudarPapel && s(g.utilizador)) {
        await rpc("ps_set_access", { p_employee: e.id, p_login: s(g.utilizador), p_password: null, p_role: role });
        return { message: `Papel de ${e.full_name} alterado.` };
      }
      const password = generatePassword();
      const login = await setAccess(e.id, s(g.utilizador) || suggestLogin(e.full_name), password, role);
      return { message: `${e.full_name} já pode entrar no Horbit.`, credentials: { name: e.full_name, login, password } };
    }
    case "retirar_acesso": {
      const e = await employee(g.id);
      await rpc("ps_remove_access", { p_employee: e.id });
      return { message: `${e.full_name} deixou de ter acesso ao Horbit.` };
    }
    case "nova_palavra_passe": {
      const e = await employee(g.id);
      const password = generatePassword();
      await rpc("ps_set_access", { p_employee: e.id, p_login: s(g.utilizador), p_password: password, p_role: s(g.papel) || null });
      return { message: "Palavra-passe nova gerada.", credentials: { name: e.full_name, login: s(g.utilizador), password } };
    }
    case "alterar_salario":
      await rpc("ps_add_salary", { p_employee: g.id, p_amount: Number(g.valor), p_from: s(g.desde) || today });
      return { message: "Salário base actualizado." };
    case "atribuir_horario":
      await rpc("ps_assign_schedule", { p_employee: g.id, p_schedule: await idByName("work_schedules", env.companyId, g.horario), p_from: s(g.desde) || today });
      return { message: "Horário atribuído." };
    default:
      throw new Error("Acção desconhecida. Actualize a página.");
  }
}

/** Controlo das acções por voz ("confirmar", "ignorar"). */
export type AiActionsHandle = { pending: () => number; confirmNext: () => Promise<string | null>; skipNext: () => boolean };

/** Lista de acções propostas, cada uma com Confirmar / Ignorar. */
export const AiActions = React.forwardRef<
  AiActionsHandle,
  {
    actions: AiAction[];
    companyId: string;
    /** Chamado com o novo estado da lista (para guardar no histórico). */
    onChange?: (actions: AiAction[]) => void;
  }
>(function AiActions({ actions, companyId, onChange }, ref) {
  const router = useRouter();
  const { company, can, tz } = useCompany();
  const [busy, setBusy] = React.useState<number | null>(null);
  const [list, setList] = React.useState(actions);
  const [outcomes, setOutcomes] = React.useState<Record<number, Outcome>>({});
  const current = React.useRef(actions);
  React.useEffect(() => {
    current.current = actions;
    setList(actions);
  }, [actions]);

  const mark = (i: number, state: AiAction["state"]) => {
    const next = current.current.map((a, j) => (j === i ? { ...a, state } : a));
    current.current = next;
    setList(next);
    onChange?.(next);
  };

  const run = async (i: number): Promise<string | null> => {
    const a = current.current[i];
    if (!a || a.state || busy !== null) return null;
    setBusy(i);
    try {
      const out = await execute(a, {
        companyId,
        companyName: company.companyName,
        tz,
        canSalary: can("employees.salary.view", "payroll.view"),
        go: (href) => router.push(href),
      });
      if (out.message) {
        setOutcomes((o) => ({ ...o, [i]: out }));
        if (!out.credentials) toast.success(out.message);
      }
      mark(i, "done");
      return out.message || "Feito.";
    } catch (e) {
      const msg = errorMessage(e);
      toast.error(msg);
      return `Não foi possível: ${msg}`;
    } finally {
      setBusy(null);
    }
  };

  React.useImperativeHandle(ref, () => ({
    pending: () => current.current.filter((a) => !a.state).length,
    confirmNext: () => run(current.current.findIndex((a) => !a.state)),
    skipNext: () => {
      const i = current.current.findIndex((a) => !a.state);
      if (i < 0) return false;
      mark(i, "skipped");
      return true;
    },
  }));

  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {list.map((a, i) => {
        const out = outcomes[i];
        return (
          <li key={i} className={cn("rounded-lg border bg-background px-3.5 py-3", a.state ? "border-border" : "border-primary/40")}>
            <p className={cn("text-[13.5px] leading-snug font-medium text-foreground", a.state && "opacity-70")}>{a.label}</p>
            {a.state ? (
              <p className={cn("mt-1.5 text-[12.5px] font-bold", a.state === "done" ? "text-success" : "text-muted")}>
                {a.state === "done" ? "Feito" : "Ignorado"}
              </p>
            ) : (
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={() => void run(i)}>
                  {busy === i ? <span className="spinner" aria-hidden /> : null}
                  {a.type === "abrir_relatorio" || a.type === "abrir_pagina" ? "Abrir" : a.type === "exportar_planilha" ? "Descarregar" : "Confirmar"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => mark(i, "skipped")}>
                  Ignorar
                </Button>
              </div>
            )}
            {out?.credentials ? <Credentials {...out.credentials} /> : null}
            {out?.mailto ? (
              <Button size="sm" variant="outline" className="mt-2" asChild>
                <a href={out.mailto}>Enviar pelo meu email</a>
              </Button>
            ) : null}
            {out && !out.credentials && out.message ? <p className="mt-1 text-[12.5px] text-muted">{out.message}</p> : null}
          </li>
        );
      })}
    </ul>
  );
});

/** Credenciais geradas: só ficam no ecrã (não vão para o histórico da conversa). */
function Credentials({ name, login, password }: { name: string; login: string; password: string }) {
  const text = `Horbit — ${name}\nUtilizador: ${login}\nPalavra-passe: ${password}`;
  return (
    <div className="mt-2.5 rounded-lg bg-surface px-3 py-2.5 text-[13px]">
      <p className="font-bold">Entregue estes dados a {name}</p>
      <p className="mt-1 font-mono">
        Utilizador: <span className="font-bold">{login}</span>
        <br />
        Palavra-passe: <span className="font-bold">{password}</span>
      </p>
      <p className="mt-1 text-[12px] text-muted">Só aparece agora. A pessoa pode mudar a palavra-passe depois de entrar.</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Copiado."), () => toast.error("Não foi possível copiar."))}
      >
        Copiar dados
      </Button>
    </div>
  );
}
