import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { HttpError } from "@/lib/errors";

export type ActionResult = { ok: true; message?: string; data?: Record<string, unknown> } | { ok: false; error: string };

/** Executa a lógica de uma server action e converte erros em mensagens para o utilizador. */
export async function runAction(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof HttpError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Dados inválidos." };
    console.error("[action]", err);
    return { ok: false, error: "Ocorreu um erro inesperado. Tente novamente." };
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
