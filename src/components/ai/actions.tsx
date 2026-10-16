"use client";

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { generatePassword, suggestLogin } from "@/components/company/p1-shared";
import { employeeReportHref, todayIn } from "@/components/company/p2-shared";
import { exportAttendance, exportEmployees } from "@/components/company/p2-reports";
import { CredentialsMail, sendMail } from "@/components/mail/send";
import { generatePassword as strongPassword } from "@/components/admin/data";
import { Button } from "@/components/ui/button";
import { errorMessage, must, rpc, sb, SUPABASE_KEY, SUPABASE_URL } from "@/lib/sb/client";
import { useSession } from "@/lib/sb/session";
import { cn } from "@/lib/utils";

/** Nome da Edge Function publicada no Supabase (no projecto actual chama-se "Ponto-ai"). */
export const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";
export const NOT_ACTIVE = `O assistente ainda não está activo. Publique a função '${AI_FUNCTION}' no Supabase.`;

/** Acção proposta pelo assistente; só acontece quando o utilizador confirma (botão ou voz). */
export type AiAction = { type: string; label: string; args: Record<string, unknown>; state?: "done" | "skipped" };
export type AiReply = { reply: string; actions: AiAction[] };

export async function invoke<T>(body: Record<string, unknown>): Promise<T> {
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

/**
 * Pergunta ao assistente com a resposta a chegar aos pedaços: onDelta recebe cada pedaço de texto
 * (para mostrar e falar logo). Se a função publicada ainda não suportar streaming, funciona como antes.
 */
export async function askAssistantStream(body: Record<string, unknown>, onDelta?: (text: string) => void): Promise<AiReply> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${AI_FUNCTION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch {
    throw new Error(`${NOT_ACTIVE} Se já está publicada, verifique a ligação à internet.`);
  }
  if (res.status === 404) throw new Error(NOT_ACTIVE);
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { reply?: string; actions?: AiAction[]; error?: string; message?: string };
    if (!res.ok || j.error || !j.reply) {
      if (res.status === 401 || res.status === 403) throw new Error(j.error ?? "Sem acesso ao assistente.");
      throw new Error(j.error ?? j.message ?? "O assistente não conseguiu responder. Tente novamente.");
    }
    onDelta?.(j.reply);
    return { reply: j.reply, actions: Array.isArray(j.actions) ? j.actions : [] };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!event.startsWith("data: ")) continue;
      const m = JSON.parse(event.slice(6)) as { d?: string; done?: boolean; reply?: string; actions?: AiAction[]; error?: string };
      if (m.error) throw new Error(m.error);
      if (m.d) {
        text += m.d;
        onDelta?.(m.d);
      }
      if (m.done) return { reply: m.reply || text, actions: Array.isArray(m.actions) ? m.actions : [] };
    }
  }
  if (text.trim()) return { reply: text, actions: [] };
  throw new Error("A resposta foi interrompida. Tente novamente.");
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
type Creds = { name: string; login: string; password: string; email?: string | null; owner?: boolean; company?: string };
type Outcome = { message: string; credentials?: Creds; mailto?: string };
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
  const { data } = await sb().from("employees").select("id,full_name,user_id,status,email").eq("id", s(id)).maybeSingle();
  if (!data) throw new Error("Colaborador não encontrado ou sem permissão para o ver.");
  return data as { id: string; full_name: string; user_id: string | null; status: string; email: string | null };
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
      return { message: `${name} criado com o nº ${p.employeeCode} e com acesso ao Horbit.`, credentials: { name, login, password, email: p.email ?? null } };
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
      return { message: `${e.full_name} já pode entrar no Horbit.`, credentials: { name: e.full_name, login, password, email: e.email } };
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
      return { message: "Palavra-passe nova gerada.", credentials: { name: e.full_name, login: s(g.utilizador), password, email: e.email } };
    }
    case "alterar_salario":
      await rpc("ps_add_salary", { p_employee: g.id, p_amount: Number(g.valor), p_from: s(g.desde) || today });
      return { message: "Salário base actualizado." };
    case "atribuir_horario":
      await rpc("ps_assign_schedule", { p_employee: g.id, p_schedule: await idByName("work_schedules", env.companyId, g.horario), p_from: s(g.desde) || today });
      return { message: "Horário atribuído." };
    case "enviar_email": {
      const to = (g.to as string[]) ?? [];
      const r = await sendMail({ companyId: env.companyId, kind: "company", to, data: { subject: s(g.assunto), text: s(g.mensagem) } });
      if (!r.ok) throw new Error(r.error);
      return { message: `Email "${s(g.assunto)}" enviado a ${r.sent ?? to.length} ${to.length === 1 ? "pessoa" : "pessoas"}.` };
    }
    case "enviar_resumo_mensal": {
      const r = await invoke<{ sent?: number; to?: string[]; month?: string }>({ mode: "monthly_report", companyId: env.companyId, force: true });
      return { message: `Resumo do mês enviado para ${(r.to ?? []).join(", ")}.` };
    }
    case "criar_lembrete":
      await rpc("ps_reminder_save", { p_company: env.companyId, p: g });
      return { message: "Lembrete criado: chega por email à hora marcada." };
    case "resumo_mensal_automatico":
      await rpc("ps_monthly_report_set", { p_company: env.companyId, p_enabled: g.ligado === true });
      return { message: g.ligado === true ? "Resumo mensal automático ligado: vai por email no início de cada mês." : "Resumo mensal automático desligado." };
    default:
      throw new Error("Acção desconhecida. Actualize a página.");
  }
}

const ASK_DETAILS = (empresa: string) =>
  `Olá,\n\nRecebemos o pedido de acesso da ${empresa} ao Horbit. Para criarmos a conta, responda a este email com:\n\n- Nome completo do responsável\n- Telefone\n- NUIT da empresa\n- Cidade\n- Número aproximado de colaboradores\n\nDepois de criarmos a conta, enviamos para este email o utilizador e a palavra-passe do responsável.\n\nCumprimentos,\nEquipa Horbit`;
const PLATFORM_PAGES: Record<string, string> = { visao: "/admin/", empresas: "/admin/empresas/", pedidos: "/admin/pedidos/", emails: "/admin/emails/", auditoria: "/admin/auditoria/" };

/** Acções do Super Admin (com a sessão dele; as regras da plataforma aplicam-se). */
async function executePlatform(a: AiAction, go: (href: string) => void): Promise<Outcome> {
  const g = a.args;
  switch (a.type) {
    case "enviar_email_plataforma": {
      const to = (g.to as string[]) ?? [];
      const r = await sendMail({ kind: "message", to, data: { subject: s(g.assunto), text: s(g.mensagem) } });
      if (!r.ok) throw new Error(r.error);
      return { message: `Email "${s(g.assunto)}" enviado para ${to.join(", ")}.` };
    }
    case "pedir_dados_pedido": {
      const r = await sendMail({ kind: "message", to: s(g.email), data: { subject: `Horbit: pedido de acesso da ${s(g.empresa)}`, text: ASK_DETAILS(s(g.empresa)) } });
      if (!r.ok) throw new Error(r.error);
      return { message: `Pedido de dados enviado para ${s(g.email)}.` };
    }
    case "criar_empresa": {
      const password = strongPassword();
      const base = (s(g.utilizador) || suggestLogin(s(g.responsavel))).toLowerCase();
      let login = base;
      for (let i = 0; ; i++) {
        login = i === 0 ? base : `${base}${i + 1}`;
        try {
          await rpc<string>("ps_admin_create_company", {
            p_name: s(g.nome),
            p_plan_code: null,
            p_owner_name: s(g.responsavel),
            p_owner_login: login,
            p_owner_password: password,
            p_nuit: s(g.nuit) || null,
            p_email: s(g.email) || null,
            p_phone: s(g.telefone) || null,
            p_trial_days: 0,
            p_request: g.pedido ?? null,
          });
          break;
        } catch (e) {
          if (i < 3 && /exist|já|duplicate/i.test(errorMessage(e)) && !/empresa/i.test(errorMessage(e))) continue;
          throw e;
        }
      }
      return {
        message: `Empresa ${s(g.nome)} criada.`,
        credentials: { name: s(g.responsavel), login, password, email: s(g.email), owner: true, company: s(g.nome) },
      };
    }
    case "estado_empresa":
      await rpc("ps_admin_set_company_status", { p_company: g.id, p_status: g.estado });
      return { message: g.estado === "active" ? `${s(g.nome)} reactivada.` : g.estado === "suspended" ? `${s(g.nome)} suspensa.` : `${s(g.nome)} cancelada.` };
    case "repor_palavra_passe_responsavel": {
      const password = strongPassword();
      const login = await rpc<string>("ps_admin_reset_owner_password", { p_company: g.id, p_password: password });
      return { message: "Palavra-passe nova gerada.", credentials: { name: `Responsável da ${s(g.nome)}`, login, password, email: (g.email as string | null) ?? null, owner: true, company: s(g.nome) } };
    }
    case "recusar_pedido":
      await rpc("ps_admin_reject_request", { p_request: g.id, p_reason: s(g.motivo) });
      return { message: "Pedido recusado." };
    case "criar_lembrete":
      await rpc("ps_reminder_save", { p_company: null, p: g });
      return { message: "Lembrete criado: chega por email à hora marcada." };
    case "abrir_pagina_plataforma":
      go(PLATFORM_PAGES[s(g.pagina)] ?? "/admin/");
      return { message: "" };
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
    /** Sem empresa = acções do Super Admin. */
    companyId?: string | null;
    /** Chamado com o novo estado da lista (para guardar no histórico). */
    onChange?: (actions: AiAction[]) => void;
  }
>(function AiActions({ actions, companyId, onChange }, ref) {
  const router = useRouter();
  const { company, can } = useSession();
  const tz = company?.timezone ?? "Africa/Maputo";
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
      const out = companyId
        ? await execute(a, {
            companyId,
            companyName: company?.companyName ?? "",
            tz,
            canSalary: can("employees.salary.view", "payroll.view"),
            go: (href) => router.push(href),
          })
        : await executePlatform(a, (href) => router.push(href));
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
            {typeof a.args.mensagem === "string" && a.args.mensagem ? (
              <details className="mt-1.5 text-[13px]" open={!a.state}>
                <summary className="cursor-pointer font-bold text-primary">Ver o email</summary>
                <p className="mt-1.5 rounded-md bg-surface px-3 py-2 leading-relaxed whitespace-pre-wrap text-foreground/90">{a.args.mensagem}</p>
              </details>
            ) : null}
            {a.state ? (
              <p className={cn("mt-1.5 text-[12.5px] font-bold", a.state === "done" ? "text-success" : "text-muted")}>
                {a.state === "done" ? "Feito" : "Ignorado"}
              </p>
            ) : (
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={() => void run(i)}>
                  {busy === i ? <span className="spinner" aria-hidden /> : null}
                  {a.type.startsWith("abrir_") ? "Abrir" : a.type === "exportar_planilha" ? "Descarregar" : /email|resumo_mensal$|pedir_dados/.test(a.type) ? "Enviar" : a.type === "criar_lembrete" ? "Agendar" : "Confirmar"}
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
function Credentials({ name, login, password, email, owner, company: companyName }: Creds) {
  const { company } = useSession();
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
      <div className="mt-2">
        <CredentialsMail
          email={email}
          name={owner ? "" : name}
          company={companyName ?? company?.companyName}
          companyId={owner ? null : company?.companyId}
          login={login}
          password={password}
          owner={owner}
        />
      </div>
    </div>
  );
}
