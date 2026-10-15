import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { can, getContext, type AppContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/rbac";

import { HttpError } from "@/lib/errors";

export { HttpError };

export function jsonError(status: number, message: string, code = "error") {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** Protecção CSRF para mutações: Origin tem de coincidir com o host. */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // navegadores modernos enviam sempre em pedidos cross-site
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new HttpError(403, "Origem do pedido inválida.", "bad_origin");
}

type Handler<T> = (args: { req: Request; ctx: AppContext & { company: NonNullable<AppContext["company"]> }; params: T }) => Promise<Response>;

/** Envolve um route handler com autenticação, empresa activa, RBAC e tratamento de erros. */
export function withCompany<T = Record<string, string>>(perms: Permission[], handler: Handler<T>) {
  return async (req: Request, segment: { params: Promise<T> }) => {
    try {
      assertSameOrigin(req);
      const ctx = await getContext();
      if (!ctx) return jsonError(401, "Sessão inválida ou expirada.", "unauthenticated");
      if (!ctx.company) return jsonError(403, "Sem empresa activa.", "no_company");
      if (perms.length && !can(ctx, ...perms)) return jsonError(403, "Sem permissão para esta operação.", "forbidden");
      const params = segment?.params ? await segment.params : ({} as T);
      return await handler({ req, ctx: ctx as AppContext & { company: NonNullable<AppContext["company"]> }, params });
    } catch (err) {
      return handleError(err);
    }
  };
}

export function handleError(err: unknown) {
  if (err instanceof HttpError) return jsonError(err.status, err.message, err.code);
  if (err instanceof ZodError) {
    return jsonError(422, err.issues.map((i) => i.message).join(" "), "validation");
  }
  console.error("[api]", err);
  return jsonError(500, "Erro interno. Tente novamente.", "internal");
}
