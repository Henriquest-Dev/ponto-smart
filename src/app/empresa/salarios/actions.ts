"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { payrollComponents, payrollItems, payrollPeriods, payrollRuleVersions, salaryPayments } from "@/lib/db/schema";
import { requireCompany } from "@/lib/auth/context";
import { audit } from "@/lib/domain/audit";
import {
  approveRun, closeAttendance, getOrCreatePeriod, issuePayslips, prepareRun, registerPayment, reopenAttendance,
} from "@/lib/domain/payroll/service";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";

async function payrollCtx(...perms: Parameters<typeof requireCompany>) {
  const ctx = await requireCompany(...perms);
  return {
    ctx,
    p: { companyId: ctx.company.id, userId: ctx.user.id, currency: ctx.company.currency, dailyDivisor: ctx.company.settings.payrollDailyDivisor },
  };
}

const done = (message: string): ActionResult => {
  revalidatePath("/empresa/salarios", "layout");
  return { ok: true, message };
};

export async function createPeriodAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await payrollCtx("payroll.prepare");
    const [y, m] = String(fd.get("month") ?? "").split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) throw new HttpError(422, "Mês inválido.");
    await getOrCreatePeriod(ctx.company.id, y, m);
    return done("Período criado.");
  });
}

export async function closeAttendanceAction(periodId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payroll.prepare");
    await closeAttendance(p, periodId);
    return done("Assiduidade fechada. Já pode gerar o pré-processamento.");
  });
}

export async function reopenAttendanceAction(periodId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payroll.prepare");
    await reopenAttendance(p, periodId);
    return done("Assiduidade reaberta. Rascunhos anteriores foram substituídos.");
  });
}

export async function prepareRunAction(periodId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payroll.prepare");
    const run = await prepareRun(p, periodId);
    return done(`Pré-processamento v${run.version} gerado. Aguarda aprovação.`);
  });
}

export async function approveRunAction(runId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payroll.approve");
    await approveRun(p, runId);
    return done("Processamento aprovado. A execução é agora imutável.");
  });
}

export async function issuePayslipsAction(runId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payslips.issue");
    const n = await issuePayslips(p, runId);
    return done(n ? `${n} recibos emitidos e colaboradores notificados.` : "Todos os recibos já estavam emitidos.");
  });
}

const paymentSchema = z.object({
  payrollItemId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido."),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(["transferencia", "mpesa", "emola", "numerario", "cheque"]),
  reference: z.string().max(80).optional(),
});

export async function registerPaymentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payments.register");
    const o = paymentSchema.parse(formObject(fd));
    await registerPayment(p, { ...o, reference: o.reference ?? null });
    return done("Pagamento registado.");
  });
}

export async function registerAllPaymentsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { p } = await payrollCtx("payments.register");
    const o = z.object({ runId: z.string().uuid(), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: paymentSchema.shape.method, reference: z.string().max(80).optional() }).parse(formObject(fd));
    const items = await db.select().from(payrollItems).where(and(eq(payrollItems.runId, o.runId), eq(payrollItems.companyId, p.companyId)));
    const paid = items.length
      ? await db.select({ id: salaryPayments.payrollItemId }).from(salaryPayments).where(inArray(salaryPayments.payrollItemId, items.map((i) => i.id)))
      : [];
    const paidSet = new Set(paid.map((x) => x.id));
    let n = 0;
    for (const it of items.filter((i) => !paidSet.has(i.id) && Number(i.net) > 0)) {
      await registerPayment(p, { payrollItemId: it.id, amount: it.net, paidAt: o.paidAt, method: o.method, reference: o.reference ?? null });
      n++;
    }
    return done(`${n} pagamentos registados.`);
  });
}

export async function closePeriodAction(periodId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await payrollCtx("payroll.approve");
    const [period] = await db.select().from(payrollPeriods).where(and(eq(payrollPeriods.id, periodId), eq(payrollPeriods.companyId, ctx.company.id))).limit(1);
    if (!period || period.status !== "approved") throw new HttpError(409, "Só é possível encerrar períodos aprovados.");
    await db.update(payrollPeriods).set({ status: "closed", closedAt: new Date() }).where(eq(payrollPeriods.id, period.id));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payroll.period_closed", entity: "payroll_period", entityId: period.id });
    return done("Período encerrado.");
  });
}

/* ------------------------------ Rubricas e regras ------------------------------ */

export async function saveComponentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await payrollCtx("payroll.prepare");
    const o = z
      .object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Código: 2–20 letras, números ou _."),
        name: z.string().trim().min(3),
        nature: z.enum(["earning", "deduction"]),
        calcType: z.enum(["fixed", "percent_base", "per_hour"]),
        rate: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
        taxable: z.string().optional(),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(formObject(fd));
    const [row] = await db
      .insert(payrollComponents)
      .values({ companyId: ctx.company.id, code: o.code, name: o.name, nature: o.nature, calcType: o.calcType, rate: o.rate ?? null, taxable: o.taxable === "on", effectiveFrom: o.effectiveFrom })
      .returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payroll.component_created", entity: "payroll_component", entityId: row.id, after: o });
    return done("Rubrica criada.");
  });
}

export async function toggleComponentAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await payrollCtx("payroll.prepare");
    await db.update(payrollComponents).set({ active }).where(and(eq(payrollComponents.id, id), eq(payrollComponents.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: active ? "payroll.component_enabled" : "payroll.component_disabled", entity: "payroll_component", entityId: id });
    return done(active ? "Rubrica activada." : "Rubrica desactivada.");
  });
}

/** Nova versão de uma regra legal/fiscal para a empresa. Versões anteriores nunca são alteradas. */
export async function saveRuleVersionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await payrollCtx("payroll.approve", "payroll.prepare");
    const o = z
      .object({
        ruleCode: z.string().min(2),
        name: z.string().min(3),
        kind: z.enum(["employee_contribution", "income_tax", "employer_contribution"]),
        ratePercent: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
        brackets: z.string().optional(),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        validatedBy: z.string().max(120).optional(),
        sourceReference: z.string().max(240).optional(),
      })
      .parse(formObject(fd));
    let brackets: { upTo: number | null; ratePercent: number; deduction: number }[] | undefined;
    if (o.kind === "income_tax") {
      try {
        brackets = JSON.parse(o.brackets ?? "[]");
        if (!Array.isArray(brackets)) throw new Error();
        for (const b of brackets) if (typeof b.ratePercent !== "number" || typeof b.deduction !== "number") throw new Error();
      } catch {
        throw new HttpError(422, 'Escalões inválidos. Formato: [{"upTo": 20250, "ratePercent": 0, "deduction": 0}, …]');
      }
    }
    const existing = await db.select({ version: payrollRuleVersions.version }).from(payrollRuleVersions).where(and(eq(payrollRuleVersions.companyId, ctx.company.id), eq(payrollRuleVersions.ruleCode, o.ruleCode)));
    const version = Math.max(0, ...existing.map((e) => e.version)) + 1;
    const validated = !!o.validatedBy;
    const [row] = await db
      .insert(payrollRuleVersions)
      .values({
        companyId: ctx.company.id,
        ruleCode: o.ruleCode,
        name: o.name,
        version,
        params: { kind: o.kind, ratePercent: o.ratePercent ? Number(o.ratePercent) : null, brackets },
        effectiveFrom: o.effectiveFrom,
        validated,
        validatedBy: o.validatedBy ?? null,
        sourceReference: o.sourceReference ?? null,
      })
      .returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payroll.rule_version_created", entity: "payroll_rule_version", entityId: row.id, after: { ruleCode: o.ruleCode, version, validated, validatedBy: o.validatedBy } });
    return done(`Regra ${o.ruleCode} v${version} registada${validated ? " e marcada como validada" : " (não validada — não será aplicada)"}.`);
  });
}

