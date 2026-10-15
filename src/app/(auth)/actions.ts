"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { memberships, notifications, sessions, users } from "@/lib/db/schema";
import { getContext, homeFor } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/mfa";
import { createSession, destroySession, readSessionRow, requestMeta } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/domain/audit";
import { runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Indique um email válido."),
  password: z.string().min(1, "Indique a palavra-passe."),
  next: z.string().optional(),
});

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let destination = "/";
  const result = await runAction(async () => {
    const input = loginSchema.parse(Object.fromEntries(fd));
    const { ip } = await requestMeta();
    await rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 300);
    await rateLimit(`login:email:${input.email}`, 6, 300);

    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    // Mensagem genérica: não revela se o email existe.
    const ok = user && user.status === "active" && (await verifyPassword(input.password, user.passwordHash));
    if (!ok) {
      await audit({ companyId: null, actorId: user?.id ?? null, action: "auth.login_failed", entity: "user", entityId: user?.id, after: { email: input.email } });
      throw new HttpError(401, "Email ou palavra-passe incorrectos.");
    }
    const [m] = await db.select({ companyId: memberships.companyId }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.active, true))).limit(1);
    await createSession(user.id, { companyId: m?.companyId ?? null, mfaPending: user.mfaEnabled });
    if (user.mfaEnabled) {
      destination = `/login/mfa${input.next ? `?next=${encodeURIComponent(input.next)}` : ""}`;
      return;
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit({ companyId: m?.companyId ?? null, actorId: user.id, action: "auth.login", entity: "user", entityId: user.id });
    const ctx = await getContext();
    destination = safeNext(input.next) ?? (ctx ? homeFor(ctx) : "/");
  });
  if (!result.ok) return result;
  redirect(destination);
}

export async function verifyMfaAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let destination = "/";
  const result = await runAction(async () => {
    const code = String(fd.get("code") ?? "");
    const session = await readSessionRow();
    if (!session || !session.mfaPending) throw new HttpError(401, "Sessão expirada. Inicie sessão novamente.");
    await rateLimit(`mfa:${session.id}`, 6, 300);
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user?.mfaSecret || !verifyTotp(decrypt(user.mfaSecret), code)) {
      await audit({ companyId: session.companyId, actorId: session.userId, action: "auth.mfa_failed", entity: "user", entityId: session.userId });
      throw new HttpError(401, "Código inválido. Verifique a aplicação de autenticação.");
    }
    await db.update(sessions).set({ mfaPending: false }).where(eq(sessions.id, session.id));
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit({ companyId: session.companyId, actorId: user.id, action: "auth.login", entity: "user", entityId: user.id, after: { mfa: true } });
    const ctx = await getContext();
    destination = safeNext(fd.get("next")?.toString()) ?? (ctx ? homeFor(ctx) : "/");
  });
  if (!result.ok) return result;
  redirect(destination);
}

export async function logoutAction() {
  const ctx = await getContext();
  if (ctx) await audit({ companyId: ctx.company?.id ?? null, actorId: ctx.user.id, action: "auth.logout", entity: "user", entityId: ctx.user.id });
  await destroySession();
  redirect("/login");
}

export async function switchCompanyAction(companyId: string) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.memberships.some((m) => m.companyId === companyId)) return;
  await db.update(sessions).set({ companyId }).where(eq(sessions.id, ctx.sessionId));
  redirect("/");
}

export async function markNotificationsReadAction() {
  const ctx = await getContext();
  if (!ctx) return;
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
  revalidatePath("/", "layout");
}
