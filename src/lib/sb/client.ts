"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Projecto Supabase do PontoSmart. A chave publicável é pública por natureza; a segurança está nas regras (RLS). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tbblsxwqclpujebzbpiu.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_H08vpjkR56vRrpMlakMJxA_S7wt-Od_";

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "pontosmart-auth" },
  });
  return client;
}

/** Nome de utilizador sem "@" → email interno (igual a ps_login_email no SQL). */
export function loginEmail(login: string) {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@pontosmart.app`;
}

/** Mensagem legível de um erro do Supabase (as funções SQL já devolvem mensagens em português). */
export function errorMessage(err: unknown): string {
  if (!err) return "Ocorreu um erro inesperado.";
  const e = err as { message?: string; code?: string; status?: number };
  const msg = e.message ?? String(err);
  if (/invalid login credentials/i.test(msg)) return "Utilizador ou palavra-passe incorrectos.";
  if (/user is banned/i.test(msg)) return "Esta conta está desactivada. Contacte o administrador da empresa.";
  if (/email not confirmed/i.test(msg)) return "Conta por confirmar. Contacte o administrador.";
  if (/failed to fetch|network/i.test(msg)) return "Sem ligação à internet. Verifique a rede e tente novamente.";
  if (/jwt expired|invalid jwt/i.test(msg)) return "Sessão expirada. Entre novamente.";
  if (e.code === "42501" && /permission denied/i.test(msg)) return "Sem permissão para esta operação.";
  if (e.code === "23505" && /duplicate key/i.test(msg)) return "Já existe um registo com esses dados.";
  if (e.code === "PGRST202") return "Função em falta no Supabase. Execute o script 04_ligar_site.sql.";
  if (e.code === "42P01" || e.code === "PGRST205") return "Tabelas em falta no Supabase. Execute os scripts SQL.";
  return msg;
}

/** Chama uma função SQL (RPC) e lança erro legível. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args ?? {});
  if (error) throw new Error(errorMessage(error));
  return data as T;
}

/** Desembrulha o resultado de uma consulta, lançando erro legível. */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data as T;
}
