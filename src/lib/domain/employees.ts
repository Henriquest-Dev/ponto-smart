import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  employees,
  employmentContracts,
  memberships,
  roles,
  salaryAgreements,
  shiftAssignments,
  users,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { randomToken } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { addDays } from "@/lib/time";
import { audit } from "./audit";

const optional = z.string().trim().optional().transform((v) => (v ? v : null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

export const employeeInput = z.object({
  fullName: z.string().trim().min(3, "Indique o nome completo."),
  employeeCode: z.string().trim().min(1, "Indique o número mecanográfico.").max(30),
  email: z.string().trim().toLowerCase().email("Email inválido.").optional().or(z.literal("").transform(() => undefined)),
  phone: optional,
  jobTitle: optional,
  departmentId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  branchId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  hireDate: date,
  nuit: optional,
  contractType: z.enum(["indeterminado", "determinado", "estagio", "prestacao_servicos"]).default("indeterminado"),
  weeklyHours: z.coerce.number().int().min(1).max(72).default(40),
  scheduleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  salary: z.string().regex(/^\d+(\.\d{1,2})?$/, "Salário inválido (use ponto decimal).").optional().or(z.literal("").transform(() => undefined)),
  createAccount: z.union([z.literal("on"), z.literal("true"), z.boolean()]).optional().transform((v) => v === "on" || v === "true" || v === true),
});

export type EmployeeInput = z.infer<typeof employeeInput>;

export async function createEmployee(opts: { companyId: string; actorId: string; canSetSalary: boolean; input: EmployeeInput }) {
  const { input } = opts;
  if (input.salary && !opts.canSetSalary) throw new HttpError(403, "Sem permissão para definir salários.");
  if (input.createAccount && !input.email) throw new HttpError(422, "Indique o email para criar a conta de acesso.");

  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.companyId, opts.companyId), eq(employees.employeeCode, input.employeeCode)))
      .limit(1);
    if (dup) throw new HttpError(409, "Já existe um colaborador com esse número mecanográfico.");

    let userId: string | null = null;
    let temporaryPassword: string | null = null;
    if (input.createAccount && input.email) {
      const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (existing) {
        userId = existing.id;
      } else {
        temporaryPassword = `Ps-${randomToken(9)}`;
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, name: input.fullName, passwordHash: await hashPassword(temporaryPassword) })
          .returning();
        userId = u.id;
      }
      const [role] = await tx.select().from(roles).where(eq(roles.code, "employee")).limit(1);
      await tx.insert(memberships).values({ userId, companyId: opts.companyId, roleId: role.id }).onConflictDoNothing();
    }

    const [emp] = await tx
      .insert(employees)
      .values({
        companyId: opts.companyId,
        userId,
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        email: input.email ?? null,
        phone: input.phone,
        jobTitle: input.jobTitle,
        departmentId: input.departmentId ?? null,
        branchId: input.branchId ?? null,
        hireDate: input.hireDate,
        nuit: input.nuit,
      })
      .returning();
    await tx.insert(employmentContracts).values({ companyId: opts.companyId, employeeId: emp.id, type: input.contractType, startDate: input.hireDate, weeklyHours: input.weeklyHours });
    if (input.scheduleId) await tx.insert(shiftAssignments).values({ companyId: opts.companyId, employeeId: emp.id, scheduleId: input.scheduleId, validFrom: input.hireDate });
    if (input.salary) await tx.insert(salaryAgreements).values({ companyId: opts.companyId, employeeId: emp.id, amount: input.salary, effectiveFrom: input.hireDate, createdBy: opts.actorId });

    await audit({ companyId: opts.companyId, actorId: opts.actorId, action: "employee.created", entity: "employee", entityId: emp.id, after: { code: emp.employeeCode, name: emp.fullName, account: !!userId } });
    return { employee: emp, temporaryPassword };
  });
}

/** Novo acordo salarial com vigência; fecha o anterior no dia anterior. Histórico imutável. */
export async function addSalaryAgreement(opts: { companyId: string; actorId: string; employeeId: string; amount: string; effectiveFrom: string }) {
  if (!/^\d+(\.\d{1,2})?$/.test(opts.amount)) throw new HttpError(422, "Valor inválido.");
  return db.transaction(async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, opts.employeeId), eq(employees.companyId, opts.companyId))).limit(1);
    if (!emp) throw new HttpError(404, "Colaborador não encontrado.");
    const open = await tx
      .select()
      .from(salaryAgreements)
      .where(and(eq(salaryAgreements.employeeId, emp.id), isNull(salaryAgreements.effectiveTo), lt(salaryAgreements.effectiveFrom, opts.effectiveFrom)));
    for (const a of open) {
      await tx.update(salaryAgreements).set({ effectiveTo: addDays(opts.effectiveFrom, -1) }).where(eq(salaryAgreements.id, a.id));
    }
    const [row] = await tx
      .insert(salaryAgreements)
      .values({ companyId: opts.companyId, employeeId: emp.id, amount: opts.amount, effectiveFrom: opts.effectiveFrom, createdBy: opts.actorId })
      .returning();
    await audit({ companyId: opts.companyId, actorId: opts.actorId, action: "salary.agreement_added", entity: "salary_agreement", entityId: row.id, before: { previous: open.map((a) => ({ id: a.id, amount: a.amount })) }, after: { amount: row.amount, effectiveFrom: row.effectiveFrom } });
    return row;
  });
}
