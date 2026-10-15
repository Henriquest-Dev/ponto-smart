"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { requireContext } from "@/lib/auth/context";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { newTotpSecret, totpFor, verifyTotp } from "@/lib/auth/mfa";
import { decrypt, encrypt } from "@/lib/crypto";
import { audit } from "@/lib/domain/audit";
import { runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";
import { and, ne } from "drizzle-orm";

export async function changePasswordAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext();
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) throw new HttpError(422, "A confirmação não coincide.");
    const policy = passwordPolicyError(next);
    if (policy) throw new HttpError(422, policy);
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!(await verifyPassword(current, user.passwordHash))) throw new HttpError(401, "Palavra-passe actual incorrecta.");
    await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id));
    // Termina as outras sessões abertas.
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, ctx.sessionId)));
    await audit({ companyId: ctx.company?.id ?? null, actorId: user.id, action: "auth.password_changed", entity: "user", entityId: user.id });
    return { ok: true, message: "Palavra-passe alterada. Outras sessões foram terminadas." };
  });
}

/** Gera um segredo TOTP pendente e devolve o QR para a aplicação de autenticação. */
export async function startMfaSetupAction(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext();
    if (ctx.user.mfaEnabled) throw new HttpError(409, "A verificação em dois passos já está activa.");
    const secret = newTotpSecret();
    await db.update(users).set({ mfaSecret: encrypt(secret) }).where(eq(users.id, ctx.user.id));
    const uri = totpFor(secret, ctx.user.email).toString();
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return { ok: true, data: { qr, secret } };
  });
}

export async function confirmMfaAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext();
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!user.mfaSecret) throw new HttpError(409, "Inicie a configuração primeiro.");
    if (!verifyTotp(decrypt(user.mfaSecret), String(fd.get("code") ?? ""))) throw new HttpError(422, "Código inválido.");
    await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
    await audit({ companyId: ctx.company?.id ?? null, actorId: user.id, action: "auth.mfa_enabled", entity: "user", entityId: user.id });
    revalidatePath("/conta/seguranca");
    return { ok: true, message: "Verificação em dois passos activada." };
  });
}

export async function disableMfaAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext();
    if (ctx.mfaSetupRequired || (ctx.company?.settings.requireMfaForAdmins && ctx.role && ["owner", "admin", "hr", "finance"].includes(ctx.role))) {
      throw new HttpError(403, "A política da empresa exige verificação em dois passos para o seu perfil.");
    }
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!(await verifyPassword(String(fd.get("password") ?? ""), user.passwordHash))) throw new HttpError(401, "Palavra-passe incorrecta.");
    await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.id, user.id));
    await audit({ companyId: ctx.company?.id ?? null, actorId: user.id, action: "auth.mfa_disabled", entity: "user", entityId: user.id });
    revalidatePath("/conta/seguranca");
    return { ok: true, message: "Verificação em dois passos desactivada." };
  });
}
