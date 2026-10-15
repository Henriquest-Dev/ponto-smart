"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { billingInvoices, companies, memberships, roles, subscriptionPlans, subscriptions, users } from "@/lib/db/schema";
import { requireContext } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { randomToken } from "@/lib/crypto";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";
import { addDays } from "@/lib/time";

const today = () => new Date().toISOString().slice(0, 10);

export async function createCompanyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.companies.manage");
    const o = z
      .object({
        name: z.string().trim().min(2),
        nuit: z.string().optional(),
        email: z.string().email().optional(),
        planId: z.string().uuid(),
        ownerName: z.string().trim().min(3),
        ownerEmail: z.string().trim().toLowerCase().email(),
        trialDays: z.coerce.number().int().min(0).max(90).default(30),
      })
      .parse(formObject(fd));
    const result = await db.transaction(async (tx) => {
      const [company] = await tx.insert(companies).values({ name: o.name, nuit: o.nuit ?? null, email: o.email ?? null, status: o.trialDays ? "trial" : "active" }).returning();
      let [owner] = await tx.select().from(users).where(eq(users.email, o.ownerEmail)).limit(1);
      let temporaryPassword: string | null = null;
      if (!owner) {
        temporaryPassword = `Ps-${randomToken(9)}`;
        [owner] = await tx.insert(users).values({ email: o.ownerEmail, name: o.ownerName, passwordHash: await hashPassword(temporaryPassword) }).returning();
      }
      const [role] = await tx.select().from(roles).where(eq(roles.code, "owner")).limit(1);
      await tx.insert(memberships).values({ userId: owner.id, companyId: company.id, roleId: role.id });
      await tx.insert(subscriptions).values({
        companyId: company.id, planId: o.planId, status: o.trialDays ? "trialing" : "active",
        currentPeriodStart: today(), currentPeriodEnd: addDays(today(), o.trialDays || 30),
      });
      return { company, temporaryPassword };
    });
    await audit({ companyId: result.company.id, actorId: ctx.user.id, action: "platform.company_created", entity: "company", entityId: result.company.id, after: { name: o.name, owner: o.ownerEmail } });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Empresa criada.", data: { temporaryPassword: result.temporaryPassword } };
  });
}

export async function setCompanyStatusAction(id: string, status: "active" | "suspended" | "cancelled"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.companies.manage");
    const [before] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!before) throw new HttpError(404, "Empresa não encontrada.");
    await db.update(companies).set({ status, updatedAt: new Date() }).where(eq(companies.id, id));
    await audit({ companyId: id, actorId: ctx.user.id, action: "platform.company_status", entity: "company", entityId: id, before: { status: before.status }, after: { status } });
    revalidatePath("/admin", "layout");
    return { ok: true, message: status === "suspended" ? "Empresa suspensa — os utilizadores deixam de ter acesso." : "Estado actualizado." };
  });
}

export async function changePlanAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.plans.manage");
    const o = z.object({ subscriptionId: z.string().uuid(), planId: z.string().uuid(), status: z.enum(["trialing", "active", "past_due", "cancelled"]) }).parse(formObject(fd));
    const [s] = await db.update(subscriptions).set({ planId: o.planId, status: o.status }).where(eq(subscriptions.id, o.subscriptionId)).returning();
    if (!s) throw new HttpError(404, "Subscrição não encontrada.");
    await audit({ companyId: s.companyId, actorId: ctx.user.id, action: "platform.subscription_changed", entity: "subscription", entityId: s.id, after: o });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Subscrição actualizada." };
  });
}

export async function savePlanAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.plans.manage");
    const o = z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,30}$/),
        name: z.string().trim().min(2),
        priceMonthly: z.string().regex(/^\d+(\.\d{1,2})?$/),
        maxEmployees: z.coerce.number().int().min(1),
        modules: z.string().optional(),
      })
      .parse(formObject(fd));
    const values = { code: o.code, name: o.name, priceMonthly: o.priceMonthly, maxEmployees: o.maxEmployees, modules: (o.modules ?? "").split(",").map((m) => m.trim()).filter(Boolean) };
    if (o.id) await db.update(subscriptionPlans).set(values).where(eq(subscriptionPlans.id, o.id));
    else await db.insert(subscriptionPlans).values(values);
    await audit({ companyId: null, actorId: ctx.user.id, action: o.id ? "platform.plan_updated" : "platform.plan_created", entity: "subscription_plan", entityId: o.id ?? null, after: values });
    revalidatePath("/admin/planos");
    return { ok: true, message: "Plano guardado." };
  });
}

export async function issueInvoiceAction(subscriptionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.billing.manage");
    const [s] = await db.select({ s: subscriptions, plan: subscriptionPlans }).from(subscriptions).innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId)).where(eq(subscriptions.id, subscriptionId)).limit(1);
    if (!s) throw new HttpError(404, "Subscrição não encontrada.");
    const number = `PS-${today().slice(0, 7)}-${randomToken(3).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
    const [inv] = await db
      .insert(billingInvoices)
      .values({ companyId: s.s.companyId, subscriptionId, number, amount: s.plan.priceMonthly, currency: s.plan.currency, status: "issued", issuedAt: today(), dueAt: addDays(today(), 15) })
      .returning();
    await audit({ companyId: s.s.companyId, actorId: ctx.user.id, action: "platform.invoice_issued", entity: "billing_invoice", entityId: inv.id, after: { number, amount: inv.amount } });
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Factura ${number} emitida.` };
  });
}

export async function setInvoiceStatusAction(id: string, status: "paid" | "void"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.billing.manage");
    const [inv] = await db.update(billingInvoices).set({ status, paidAt: status === "paid" ? today() : null }).where(and(eq(billingInvoices.id, id))).returning();
    if (!inv) throw new HttpError(404, "Factura não encontrada.");
    await audit({ companyId: inv.companyId, actorId: ctx.user.id, action: `platform.invoice_${status}`, entity: "billing_invoice", entityId: id });
    revalidatePath("/admin", "layout");
    return { ok: true, message: status === "paid" ? "Pagamento registado." : "Factura anulada." };
  });
}
