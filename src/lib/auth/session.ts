import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "ps_session";
const SESSION_DAYS = 7;

import { requestMeta } from "@/lib/request";

export { requestMeta };

export async function createSession(userId: string, opts: { companyId: string | null; mfaPending: boolean }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const meta = await requestMeta();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    companyId: opts.companyId,
    mfaPending: opts.mfaPending,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionRow() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  store.delete(SESSION_COOKIE);
}
