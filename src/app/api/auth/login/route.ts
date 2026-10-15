import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, HttpError, assertSameOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { memberships, users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, requestMeta } from "@/lib/auth/session";
import { audit } from "@/lib/domain/audit";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — autenticação (cookie httpOnly). Com MFA activo, devolve mfaRequired. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const input = z.object({ email: z.string().trim().toLowerCase().min(3).max(200), password: z.string().min(1) }).parse(await req.json());
    const { ip } = await requestMeta();
    await rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 300);
    await rateLimit(`login:email:${input.email}`, 6, 300);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || user.status !== "active" || !(await verifyPassword(input.password, user.passwordHash))) {
      await audit({ companyId: null, actorId: user?.id ?? null, action: "auth.login_failed", entity: "user", entityId: user?.id, after: { email: input.email, via: "api" } });
      throw new HttpError(401, "Utilizador ou palavra-passe incorrectos.", "invalid_credentials");
    }
    const [m] = await db.select({ companyId: memberships.companyId }).from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.active, true))).limit(1);
    await createSession(user.id, { companyId: m?.companyId ?? null, mfaPending: user.mfaEnabled });
    if (!user.mfaEnabled) await audit({ companyId: m?.companyId ?? null, actorId: user.id, action: "auth.login", entity: "user", entityId: user.id, after: { via: "api" } });
    return NextResponse.json({ ok: true, mfaRequired: user.mfaEnabled });
  } catch (err) {
    return handleError(err);
  }
}
