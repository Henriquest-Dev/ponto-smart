import { errorMessage } from "@/lib/sb/client";

export type ActionResult = { ok: true; message?: string; data?: Record<string, unknown> } | { ok: false; error: string };

/** Executa uma operação (Supabase) e devolve um resultado para os formulários/botões. */
export async function attempt(fn: () => Promise<ActionResult | string | void>): Promise<ActionResult> {
  try {
    const r = await fn();
    if (typeof r === "string") return { ok: true, message: r };
    return r ?? { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : errorMessage(err) };
  }
}

/** Converte FormData em objecto simples (strings vazias → undefined). */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v.trim() === "" ? undefined : v.trim();
  }
  return out;
}
