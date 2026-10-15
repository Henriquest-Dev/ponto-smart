"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { employeeComponents, employees, payrollComponents, shiftAssignments, trustedDevices } from "@/lib/db/schema";
import { can, requireCompany } from "@/lib/auth/context";
import { addSalaryAgreement, createEmployee, employeeInput } from "@/lib/domain/employees";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";
import { addDays } from "@/lib/time";

export async function createEmployeeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("employees.manage");
    const input = employeeInput.parse(formObject(fd));
    const { employee, temporaryPassword } = await createEmployee({ companyId: ctx.company.id, actorId: ctx.user.id, canSetSalary: can(ctx, "employees.salary.view"), input });
    revalidatePath("/empresa/colaboradores");
    return {
      ok: true,
      message: "Colaborador criado.",
      data: { id: employee.id, temporaryPassword, email: employee.email },
    };
  });
}

const updateSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(3),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  nuit: z.string().optional(),
  status: z.enum(["active", "inactive", "terminated"]),
});

export async function updateEmployeeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("employees.manage");
    const input = updateSchema.parse(formObject(fd));
    const [before] = await db.select().from(employees).where(and(eq(employees.id, input.id), eq(employees.companyId, ctx.company.id))).limit(1);
    if (!before) throw new HttpError(404, "Colaborador não encontrado.");
    const patch = {
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      jobTitle: input.jobTitle ?? null,
      departmentId: input.departmentId ?? null,
      branchId: input.branchId ?? null,
      nuit: input.nuit ?? null,
      status: input.status,
    };
    await db.update(employees).set(patch).where(eq(employees.id, before.id));
    await audit({
      companyId: ctx.company.id, actorId: ctx.user.id, action: "employee.updated", entity: "employee", entityId: before.id,
      before: { fullName: before.fullName, departmentId: before.departmentId, status: before.status, jobTitle: before.jobTitle },
      after: patch,
    });
    revalidatePath(`/empresa/colaboradores/${before.id}`);
    return { ok: true, message: "Ficha actualizada." };
  });
}

export async function addSalaryAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("employees.salary.view");
    const o = formObject(fd);
    await addSalaryAgreement({ companyId: ctx.company.id, actorId: ctx.user.id, employeeId: o.employeeId ?? "", amount: o.amount ?? "", effectiveFrom: o.effectiveFrom ?? "" });
    revalidatePath(`/empresa/colaboradores/${o.employeeId}`);
    return { ok: true, message: "Novo acordo salarial registado." };
  });
}

export async function assignScheduleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("schedules.manage");
    const o = z.object({ employeeId: z.string().uuid(), scheduleId: z.string().uuid(), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(formObject(fd));
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, o.employeeId), eq(employees.companyId, ctx.company.id))).limit(1);
    if (!emp) throw new HttpError(404, "Colaborador não encontrado.");
    const current = await db.select().from(shiftAssignments).where(eq(shiftAssignments.employeeId, emp.id));
    for (const a of current.filter((a) => !a.validTo || a.validTo >= o.validFrom)) {
      if (a.validFrom >= o.validFrom) await db.delete(shiftAssignments).where(eq(shiftAssignments.id, a.id));
      else await db.update(shiftAssignments).set({ validTo: addDays(o.validFrom, -1) }).where(eq(shiftAssignments.id, a.id));
    }
    await db.insert(shiftAssignments).values({ companyId: ctx.company.id, employeeId: emp.id, scheduleId: o.scheduleId, validFrom: o.validFrom });
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "schedule.assigned", entity: "employee", entityId: emp.id, after: o });
    revalidatePath(`/empresa/colaboradores/${emp.id}`);
    return { ok: true, message: "Horário atribuído." };
  });
}

export async function assignComponentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("payroll.prepare");
    const o = z
      .object({
        employeeId: z.string().uuid(),
        componentId: z.string().uuid(),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido."),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        note: z.string().max(200).optional(),
      })
      .parse(formObject(fd));
    const [comp] = await db.select().from(payrollComponents).where(and(eq(payrollComponents.id, o.componentId), eq(payrollComponents.companyId, ctx.company.id))).limit(1);
    if (!comp) throw new HttpError(404, "Rubrica não encontrada.");
    const [row] = await db.insert(employeeComponents).values({ companyId: ctx.company.id, ...o, effectiveTo: o.effectiveTo ?? null, note: o.note ?? null }).returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payroll.component_assigned", entity: "employee_component", entityId: row.id, after: o });
    revalidatePath(`/empresa/colaboradores/${o.employeeId}`);
    return { ok: true, message: "Rubrica atribuída." };
  });
}

export async function endComponentAction(id: string, employeeId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("payroll.prepare");
    const today = new Date().toISOString().slice(0, 10);
    await db.update(employeeComponents).set({ effectiveTo: today }).where(and(eq(employeeComponents.id, id), eq(employeeComponents.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payroll.component_ended", entity: "employee_component", entityId: id });
    revalidatePath(`/empresa/colaboradores/${employeeId}`);
    return { ok: true, message: "Rubrica terminada." };
  });
}

export async function revokeEmployeeDeviceAction(id: string, employeeId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("employees.manage");
    await db.update(trustedDevices).set({ revokedAt: new Date() }).where(and(eq(trustedDevices.id, id), eq(trustedDevices.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "device.revoked_by_admin", entity: "trusted_device", entityId: id });
    revalidatePath(`/empresa/colaboradores/${employeeId}`);
    return { ok: true, message: "Dispositivo revogado." };
  });
}
