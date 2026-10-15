import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptionPlans } from "@/lib/db/schema";

/** Planos activos para a página pública (tolerante a falhas da BD). */
export async function publicPlans() {
  try {
    return await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.active, true)).orderBy(asc(subscriptionPlans.priceMonthly));
  } catch (err) {
    console.error("[home] planos indisponíveis", err);
    return [];
  }
}
