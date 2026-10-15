import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, memberships, roles, subscriptions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { randomToken } from "@/lib/crypto";
import { addDays } from "@/lib/time";

/**
 * Cria a conta de uma empresa cliente: empresa, subscrição e credenciais do
 * proprietário. A partir daí é a empresa que cria as credenciais dos colaboradores.
 */
export async function provisionCompany(input: {
  name: string;
  nuit?: string | null;
  email?: string | null;
  phone?: string | null;
  planId: string;
  ownerName: string;
  ownerEmail: string;
  trialDays: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: input.name, nuit: input.nuit ?? null, email: input.email ?? null, phone: input.phone ?? null, status: input.trialDays ? "trial" : "active" })
      .returning();
    let [owner] = await tx.select().from(users).where(eq(users.email, input.ownerEmail)).limit(1);
    let temporaryPassword: string | null = null;
    if (!owner) {
      temporaryPassword = `Ps-${randomToken(9)}`;
      [owner] = await tx.insert(users).values({ email: input.ownerEmail, name: input.ownerName, passwordHash: await hashPassword(temporaryPassword) }).returning();
    }
    const [role] = await tx.select().from(roles).where(eq(roles.code, "owner")).limit(1);
    await tx.insert(memberships).values({ userId: owner.id, companyId: company.id, roleId: role.id });
    await tx.insert(subscriptions).values({
      companyId: company.id,
      planId: input.planId,
      status: input.trialDays ? "trialing" : "active",
      currentPeriodStart: today,
      currentPeriodEnd: addDays(today, input.trialDays || 30),
    });
    return { company, owner, temporaryPassword };
  });
}
