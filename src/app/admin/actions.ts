"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { billingInvoices, companies, companyRequests, subscriptionPlans, subscriptions } from "@/lib/db/schema";
import { requireContext } from "@/lib/auth/context";
import { randomToken } from "@/lib/crypto";
import { audit } from "@/lib/domain/audit";
import { provisionCompany } from "@/lib/domain/companies";
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
    const result = await provisionCompany({ name: o.name, nuit: o.nuit, email: o.email, planId: o.planId, ownerName: o.ownerName, ownerEmail: o.ownerEmail, trialDays: o.trialDays });
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

/* ------------------------- Pedidos de conta (home pública) ------------------------- */

export async function approveRequestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.companies.manage");
    const o = z
      .object({ requestId: z.string().uuid(), planId: z.string().uuid(), trialDays: z.coerce.number().int().min(0).max(90).default(30) })
      .parse(formObject(fd));
    const [req] = await db.select().from(companyRequests).where(eq(companyRequests.id, o.requestId)).limit(1);
    if (!req) throw new HttpError(404, "Pedido não encontrado.");
    if (req.status !== "pending") throw new HttpError(409, "Este pedido já foi tratado.");
    const result = await provisionCompany({
      name: req.companyName, nuit: req.nuit, email: req.email, phone: req.phone, planId: o.planId,
      ownerName: req.contactName, ownerEmail: req.email.toLowerCase(), trialDays: o.trialDays,
    });
    await db.update(companyRequests).set({ status: "approved", companyId: result.company.id, decidedBy: ctx.user.id, decidedAt: new Date() }).where(eq(companyRequests.id, req.id));
    await audit({ companyId: result.company.id, actorId: ctx.user.id, action: "platform.request_approved", entity: "company_request", entityId: req.id, after: { company: req.companyName, owner: req.email } });
    // Sem revalidação aqui: a lista só é actualizada quando o diálogo fecha,
    // para que as credenciais temporárias fiquem visíveis.
    return { ok: true, message: "Conta da empresa criada.", data: { temporaryPassword: result.temporaryPassword, email: req.email } };
  });
}

export async function rejectRequestAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext("platform.companies.manage");
    const res = await db
      .update(companyRequests)
      .set({ status: "rejected", decidedBy: ctx.user.id, decidedAt: new Date() })
      .where(and(eq(companyRequests.id, id), eq(companyRequests.status, "pending")))
      .returning({ id: companyRequests.id });
    if (!res.length) throw new HttpError(409, "Pedido já tratado ou inexistente.");
    await audit({ companyId: null, actorId: ctx.user.id, action: "platform.request_rejected", entity: "company_request", entityId: id });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Pedido recusado." };
  });
}
