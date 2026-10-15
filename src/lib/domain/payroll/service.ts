import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attendanceDaily,
  companies,
  departments,
  employeeComponents,
  employees,
  employmentContracts,
  payrollComponents,
  payrollItems,
  payrollLines,
  payrollPeriods,
  payrollRuleVersions,
  payrollRuns,
  payslips,
  salaryAgreements,
  salaryPayments,
} from "@/lib/db/schema";
import { HttpError } from "@/lib/errors";
import { monthRange } from "@/lib/time";
import { putPrivateFile } from "@/lib/storage";
import { audit } from "../audit";
import { notifyUsers } from "../notifications";
import { runPayroll, type EngineComponent, type EngineInput } from "./engine";
import { renderPayslipPdf } from "./payslip-pdf";

type Ctx = { companyId: string; userId: string; currency: string; dailyDivisor: number };

export async function getOrCreatePeriod(
  companyId: string,
  year: number,
  month: number,
): Promise<typeof payrollPeriods.$inferSelect> {
  const [existing] = await db
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.companyId, companyId), eq(payrollPeriods.year, year), eq(payrollPeriods.month, month)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(payrollPeriods).values({ companyId, year, month }).onConflictDoNothing().returning();
  return created ?? (await getOrCreatePeriod(companyId, year, month));
}

async function loadPeriod(companyId: string, periodId: string) {
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.id, periodId), eq(payrollPeriods.companyId, companyId)))
    .limit(1);
  if (!period) throw new HttpError(404, "Período não encontrado.");
  return period;
}

/** Pendências de assiduidade que impedem o fecho do período. */
export async function attendancePendings(companyId: string, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  return db
    .select({
      id: attendanceDaily.id,
      workDate: attendanceDaily.workDate,
      status: attendanceDaily.status,
      employeeId: employees.id,
      employeeName: employees.fullName,
    })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .where(
      and(
        eq(attendanceDaily.companyId, companyId),
        gte(attendanceDaily.workDate, from),
        lte(attendanceDaily.workDate, to),
        inArray(attendanceDaily.status, ["absent_pending", "review", "incomplete"]),
      ),
    )
    .orderBy(asc(attendanceDaily.workDate));
}

export async function closeAttendance(ctx: Ctx, periodId: string) {
  const period = await loadPeriod(ctx.companyId, periodId);
  if (period.status !== "open") throw new HttpError(409, "A assiduidade deste período já está fechada.");
  const pendings = await attendancePendings(ctx.companyId, period.year, period.month);
  if (pendings.length) {
    throw new HttpError(409, `Existem ${pendings.length} pendências de assiduidade por resolver antes do fecho.`, "pendings");
  }
  const { from, to } = monthRange(period.year, period.month);
  await db.transaction(async (tx) => {
    await tx
      .update(attendanceDaily)
      .set({ locked: true })
      .where(and(eq(attendanceDaily.companyId, ctx.companyId), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to)));
    await tx
      .update(payrollPeriods)
      .set({ status: "attendance_closed", attendanceClosedAt: new Date() })
      .where(eq(payrollPeriods.id, period.id));
  });
  await audit({ companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.attendance_closed", entity: "payroll_period", entityId: period.id });
}

export async function reopenAttendance(ctx: Ctx, periodId: string) {
  const period = await loadPeriod(ctx.companyId, periodId);
  if (period.status !== "attendance_closed") throw new HttpError(409, "Só é possível reabrir períodos com assiduidade fechada e sem aprovação.");
  const { from, to } = monthRange(period.year, period.month);
  await db.transaction(async (tx) => {
    await tx
      .update(attendanceDaily)
      .set({ locked: false })
      .where(and(eq(attendanceDaily.companyId, ctx.companyId), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to)));
    await tx.update(payrollPeriods).set({ status: "open", attendanceClosedAt: null }).where(eq(payrollPeriods.id, period.id));
    await tx
      .update(payrollRuns)
      .set({ status: "superseded" })
      .where(and(eq(payrollRuns.periodId, period.id), eq(payrollRuns.status, "draft")));
  });
  await audit({ companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.attendance_reopened", entity: "payroll_period", entityId: period.id });
}

/** Constrói o input determinístico do motor a partir da base de dados. */
export async function buildEngineInput(ctx: Ctx, year: number, month: number): Promise<EngineInput> {
  const { from, to } = monthRange(year, month);
  const staff = await db
    .select({ id: employees.id, code: employees.employeeCode, name: employees.fullName })
    .from(employees)
    .where(and(eq(employees.companyId, ctx.companyId), eq(employees.status, "active"), or(isNull(employees.hireDate), lte(employees.hireDate, to))))
    .orderBy(asc(employees.employeeCode));
  const ids = staff.map((s) => s.id);

  const salaries = ids.length
    ? await db
        .select()
        .from(salaryAgreements)
        .where(and(inArray(salaryAgreements.employeeId, ids), lte(salaryAgreements.effectiveFrom, to), or(isNull(salaryAgreements.effectiveTo), gte(salaryAgreements.effectiveTo, from))))
        .orderBy(desc(salaryAgreements.effectiveFrom))
    : [];
  const contracts = ids.length
    ? await db
        .select()
        .from(employmentContracts)
        .where(and(inArray(employmentContracts.employeeId, ids), lte(employmentContracts.startDate, to)))
        .orderBy(desc(employmentContracts.startDate))
    : [];
  const daily = ids.length
    ? await db
        .select({ employeeId: attendanceDaily.employeeId, status: attendanceDaily.status, overtime: attendanceDaily.overtimeMinutes, worked: attendanceDaily.workedMinutes })
        .from(attendanceDaily)
        .where(and(eq(attendanceDaily.companyId, ctx.companyId), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to)))
    : [];
  const assigned = ids.length
    ? await db
        .select({ ec: employeeComponents, c: payrollComponents })
        .from(employeeComponents)
        .innerJoin(payrollComponents, eq(payrollComponents.id, employeeComponents.componentId))
        .where(
          and(
            eq(employeeComponents.companyId, ctx.companyId),
            eq(payrollComponents.active, true),
            lte(employeeComponents.effectiveFrom, to),
            or(isNull(employeeComponents.effectiveTo), gte(employeeComponents.effectiveTo, from)),
          ),
        )
    : [];
  const [overtime] = await db
    .select()
    .from(payrollComponents)
    .where(
      and(
        eq(payrollComponents.companyId, ctx.companyId),
        eq(payrollComponents.calcType, "per_hour"),
        eq(payrollComponents.active, true),
        lte(payrollComponents.effectiveFrom, to),
        or(isNull(payrollComponents.effectiveTo), gte(payrollComponents.effectiveTo, from)),
      ),
    )
    .limit(1);
  const rules = await db
    .select()
    .from(payrollRuleVersions)
    .where(
      and(
        or(isNull(payrollRuleVersions.companyId), eq(payrollRuleVersions.companyId, ctx.companyId)),
        lte(payrollRuleVersions.effectiveFrom, to),
        or(isNull(payrollRuleVersions.effectiveTo), gte(payrollRuleVersions.effectiveTo, from)),
      ),
    )
    .orderBy(asc(payrollRuleVersions.ruleCode), desc(payrollRuleVersions.version));
  // Uma versão por regra (a mais recente; a da empresa sobrepõe-se à global).
  const latestRules = new Map<string, (typeof rules)[number]>();
  for (const r of rules) {
    const current = latestRules.get(r.ruleCode);
    if (!current || (r.companyId && !current.companyId)) latestRules.set(r.ruleCode, r);
  }

  const toComponent = (c: typeof payrollComponents.$inferSelect, value: string): EngineComponent => ({
    code: c.code, name: c.name, nature: c.nature, calcType: c.calcType, value, taxable: c.taxable,
  });

  return {
    period: { year, month },
    currency: ctx.currency,
    dailyDivisor: ctx.dailyDivisor,
    overtimeComponent: overtime ? toComponent(overtime, overtime.rate ?? "1") : null,
    rules: [...latestRules.values()].map((r) => ({
      id: r.id, ruleCode: r.ruleCode, name: r.name, version: r.version, validated: r.validated, params: r.params,
    })),
    employees: staff.map((s) => {
      const days = daily.filter((d) => d.employeeId === s.id);
      return {
        employeeId: s.id,
        code: s.code,
        name: s.name,
        baseSalary: salaries.find((a) => a.employeeId === s.id)?.amount ?? null,
        weeklyHours: contracts.find((c) => c.employeeId === s.id)?.weeklyHours ?? 40,
        attendance: {
          unjustifiedDays: days.filter((d) => d.status === "unjustified").length,
          overtimeMinutes: days.reduce((sum, d) => sum + d.overtime, 0),
          workedDays: days.filter((d) => d.worked > 0).length,
        },
        components: assigned
          .filter((a) => a.ec.employeeId === s.id && a.c.calcType !== "per_hour")
          .map((a) => toComponent(a.c, a.ec.amount)),
      };
    }),
  };
}

export async function prepareRun(ctx: Ctx, periodId: string) {
  const period = await loadPeriod(ctx.companyId, periodId);
  if (period.status !== "attendance_closed") {
    throw new HttpError(409, "Feche a assiduidade do período antes do pré-processamento.");
  }
  const input = await buildEngineInput(ctx, period.year, period.month);
  const output = runPayroll(input);

  const run = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${period.id}))`);
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${payrollRuns.version}), 0)` })
      .from(payrollRuns)
      .where(eq(payrollRuns.periodId, period.id));
    await tx
      .update(payrollRuns)
      .set({ status: "superseded" })
      .where(and(eq(payrollRuns.periodId, period.id), eq(payrollRuns.status, "draft")));
    const [run] = await tx
      .insert(payrollRuns)
      .values({
        companyId: ctx.companyId,
        periodId: period.id,
        version: Number(max) + 1,
        status: "draft",
        engineVersion: output.engineVersion,
        inputHash: output.inputHash,
        preparedBy: ctx.userId,
        totals: output.totals,
        warnings: output.warnings,
      })
      .returning();
    for (const item of output.items) {
      const emp = input.employees.find((e) => e.employeeId === item.employeeId)!;
      const [row] = await tx
        .insert(payrollItems)
        .values({
          companyId: ctx.companyId,
          runId: run.id,
          employeeId: item.employeeId,
          gross: item.gross,
          deductions: item.deductions,
          net: item.net,
          currency: ctx.currency,
          snapshot: { baseSalary: emp.baseSalary, attendance: emp.attendance, taxableBase: item.taxableBase, employerCosts: item.employerCosts },
        })
        .returning({ id: payrollItems.id });
      if (item.lines.length) {
        await tx.insert(payrollLines).values(
          item.lines.map((l) => ({ ...l, companyId: ctx.companyId, payrollItemId: row.id })),
        );
      }
    }
    return run;
  });
  await audit({
    companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.run_prepared", entity: "payroll_run", entityId: run.id,
    after: { version: run.version, totals: run.totals, inputHash: run.inputHash },
  });
  return run;
}

export async function approveRun(ctx: Ctx, runId: string) {
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, ctx.companyId)))
    .limit(1);
  if (!run) throw new HttpError(404, "Execução não encontrada.");
  if (run.status !== "draft") throw new HttpError(409, "Apenas execuções em rascunho podem ser aprovadas.");
  // Separação de funções: quem prepara não aprova.
  if (run.preparedBy === ctx.userId) {
    throw new HttpError(403, "Separação de funções: a aprovação tem de ser feita por outra pessoa.", "segregation");
  }
  // Reprodutibilidade: o input actual tem de coincidir com o calculado.
  const period = await loadPeriod(ctx.companyId, run.periodId);
  const current = runPayroll(await buildEngineInput(ctx, period.year, period.month));
  if (current.inputHash !== run.inputHash) {
    throw new HttpError(409, "Os dados mudaram desde o pré-processamento. Gere uma nova versão.", "stale_run");
  }
  await db.transaction(async (tx) => {
    await tx.update(payrollRuns).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(payrollRuns.id, run.id));
    await tx.update(payrollPeriods).set({ status: "approved" }).where(eq(payrollPeriods.id, run.periodId));
  });
  await audit({ companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.run_approved", entity: "payroll_run", entityId: run.id, after: { version: run.version } });
}

export async function payslipData(companyId: string, payslipId: string) {
  const [row] = await db
    .select({ payslip: payslips, item: payrollItems, run: payrollRuns, period: payrollPeriods, employee: employees, company: companies, department: departments.name })
    .from(payslips)
    .innerJoin(payrollItems, eq(payrollItems.id, payslips.payrollItemId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .innerJoin(companies, eq(companies.id, payslips.companyId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(payslips.id, payslipId), eq(payslips.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const lines = await db.select().from(payrollLines).where(eq(payrollLines.payrollItemId, row.item.id)).orderBy(asc(payrollLines.sort));
  return { ...row, lines };
}

export async function renderPayslip(companyId: string, payslipId: string) {
  const data = await payslipData(companyId, payslipId);
  if (!data) return null;
  const bytes = await renderPayslipPdf({
    reference: data.payslip.reference,
    company: { name: data.company.legalName ?? data.company.name, nuit: data.company.nuit, address: data.company.address },
    employee: { name: data.employee.fullName, code: data.employee.employeeCode, jobTitle: data.employee.jobTitle, nuit: data.employee.nuit, department: data.department },
    period: { year: data.period.year, month: data.period.month },
    run: { version: data.run.version, engineVersion: data.run.engineVersion, inputHash: data.run.inputHash, approvedAt: data.run.approvedAt },
    currency: data.item.currency,
    lines: data.lines.map((l) => ({ code: l.code, description: l.description, nature: l.nature, quantity: l.quantity, amount: l.amount })),
    gross: data.item.gross,
    deductions: data.item.deductions,
    net: data.item.net,
    issuedAt: data.payslip.issuedAt,
  });
  return { bytes, data };
}

export async function issuePayslips(ctx: Ctx, runId: string) {
  const [run] = await db
    .select({ run: payrollRuns, period: payrollPeriods })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, ctx.companyId)))
    .limit(1);
  if (!run) throw new HttpError(404, "Execução não encontrada.");
  if (run.run.status !== "approved") throw new HttpError(409, "Só é possível emitir recibos de execuções aprovadas.");

  const items = await db
    .select({ id: payrollItems.id, employeeId: payrollItems.employeeId, userId: employees.userId })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.run.id));
  const existing = await db.select({ itemId: payslips.payrollItemId }).from(payslips).where(eq(payslips.runId, run.run.id));
  const done = new Set(existing.map((e) => e.itemId));
  let issued = 0;
  for (const [i, item] of items.entries()) {
    if (done.has(item.id)) continue;
    const reference = `RV-${run.period.year}${String(run.period.month).padStart(2, "0")}-${run.run.id.slice(0, 6).toUpperCase()}-${String(i + 1).padStart(3, "0")}`;
    const [slip] = await db
      .insert(payslips)
      .values({ companyId: ctx.companyId, payrollItemId: item.id, employeeId: item.employeeId, runId: run.run.id, reference, issuedBy: ctx.userId })
      .returning();
    // Guarda uma cópia imutável do PDF; se o armazenamento falhar, o recibo é
    // regenerado de forma determinística a partir da execução aprovada.
    try {
      const rendered = await renderPayslip(ctx.companyId, slip.id);
      if (rendered) {
        const key = `companies/${ctx.companyId}/payslips/${slip.id}.pdf`;
        const bytes = rendered.bytes;
        await putPrivateFile(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "application/pdf");
        await db.update(payslips).set({ documentKey: key }).where(eq(payslips.id, slip.id));
      }
    } catch (err) {
      console.warn("[payslips] armazenamento indisponível; o PDF será gerado a pedido.", err instanceof Error ? err.message : err);
    }
    if (item.userId) {
      await notifyUsers(ctx.companyId, [item.userId], {
        kind: "payslip",
        title: "Novo recibo disponível",
        body: `O recibo de ${String(run.period.month).padStart(2, "0")}/${run.period.year} já está disponível.`,
        link: "/app/recibos",
      });
    }
    issued++;
  }
  await audit({ companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.payslips_issued", entity: "payroll_run", entityId: run.run.id, after: { issued } });
  return issued;
}

export async function registerPayment(
  ctx: Ctx,
  input: { payrollItemId: string; amount: string; paidAt: string; method: string; reference: string | null },
) {
  const [item] = await db
    .select({ item: payrollItems, run: payrollRuns })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.id, input.payrollItemId), eq(payrollItems.companyId, ctx.companyId)))
    .limit(1);
  if (!item) throw new HttpError(404, "Linha salarial não encontrada.");
  if (item.run.status !== "approved") throw new HttpError(409, "Só é possível registar pagamentos de execuções aprovadas.");
  const [payment] = await db
    .insert(salaryPayments)
    .values({ companyId: ctx.companyId, payrollItemId: item.item.id, amount: input.amount, paidAt: input.paidAt, method: input.method, reference: input.reference, registeredBy: ctx.userId })
    .returning();
  await audit({ companyId: ctx.companyId, actorId: ctx.userId, action: "payroll.payment_registered", entity: "salary_payment", entityId: payment.id, after: input });
  return payment;
}
