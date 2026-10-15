"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { branches, companies, departments, memberships, roles, users } from "@/lib/db/schema";
import { requireCompany } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { ROLES } from "@/lib/auth/rbac";
import { randomToken } from "@/lib/crypto";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";

export async function saveCompanyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("company.settings.manage");
    const o = z
      .object({
        name: z.string().trim().min(2),
        legalName: z.string().optional(),
        nuit: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        timezone: z.string().min(3),
        currency: z.string().length(3),
        devicePolicy: z.enum(["off", "warn", "require"]),
        absenceFlow: z.enum(["single", "supervisor_then_hr"]),
        requireMfaForAdmins: z.string().optional(),
        duplicateWindowMinutes: z.coerce.number().int().min(1).max(30),
        payrollDailyDivisor: z.coerce.number().int().min(20).max(31),
      })
      .parse(formObject(fd));
    try {
      new Intl.DateTimeFormat("en", { timeZone: o.timezone });
    } catch {
      throw new HttpError(422, "Fuso horário inválido (ex.: Africa/Maputo).");
    }
    const settings = {
      devicePolicy: o.devicePolicy,
      absenceFlow: o.absenceFlow,
      requireMfaForAdmins: o.requireMfaForAdmins === "on",
      duplicateWindowMinutes: o.duplicateWindowMinutes,
      payrollDailyDivisor: o.payrollDailyDivisor,
    };
    await db
      .update(companies)
      .set({ name: o.name, legalName: o.legalName ?? null, nuit: o.nuit ?? null, email: o.email ?? null, phone: o.phone ?? null, address: o.address ?? null, timezone: o.timezone, currency: o.currency.toUpperCase(), settings, updatedAt: new Date() })
      .where(eq(companies.id, ctx.company.id));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "company.settings_updated", entity: "company", entityId: ctx.company.id, before: { settings: ctx.company.settings }, after: { settings } });
    revalidatePath("/empresa", "layout");
    return { ok: true, message: "Definições guardadas." };
  });
}

export async function addBranchAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("org.manage");
    const o = z.object({ name: z.string().trim().min(2), city: z.string().optional(), address: z.string().optional() }).parse(formObject(fd));
    const [b] = await db.insert(branches).values({ companyId: ctx.company.id, name: o.name, city: o.city ?? null, address: o.address ?? null }).returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "org.branch_created", entity: "branch", entityId: b.id, after: o });
    revalidatePath("/empresa/definicoes");
    return { ok: true, message: "Filial criada." };
  });
}

export async function addDepartmentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("org.manage");
    const o = z.object({ name: z.string().trim().min(2), branchId: z.string().uuid().optional(), managerUserId: z.string().uuid().optional() }).parse(formObject(fd));
    const [d] = await db.insert(departments).values({ companyId: ctx.company.id, name: o.name, branchId: o.branchId ?? null, managerUserId: o.managerUserId ?? null }).returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "org.department_created", entity: "department", entityId: d.id, after: o });
    revalidatePath("/empresa/definicoes");
    return { ok: true, message: "Departamento criado." };
  });
}

export async function setDepartmentManagerAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("org.manage");
    const o = z.object({ id: z.string().uuid(), managerUserId: z.string().uuid().optional() }).parse(formObject(fd));
    await db.update(departments).set({ managerUserId: o.managerUserId ?? null }).where(and(eq(departments.id, o.id), eq(departments.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "org.department_manager_set", entity: "department", entityId: o.id, after: o });
    revalidatePath("/empresa/definicoes");
    return { ok: true, message: "Responsável actualizado." };
  });
}

const assignable = ["owner", "admin", "hr", "finance", "supervisor", "employee"] as const;

export async function inviteUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("users.manage");
    const o = z.object({ name: z.string().trim().min(3), email: z.string().trim().toLowerCase().email(), role: z.enum(assignable) }).parse(formObject(fd));
    if (o.role === "owner" && ctx.role !== "owner") throw new HttpError(403, "Só o proprietário pode atribuir o papel de proprietário.");
    const [role] = await db.select().from(roles).where(eq(roles.code, o.role)).limit(1);
    let [user] = await db.select().from(users).where(eq(users.email, o.email)).limit(1);
    let temporaryPassword: string | null = null;
    if (!user) {
      temporaryPassword = `Ps-${randomToken(9)}`;
      [user] = await db.insert(users).values({ email: o.email, name: o.name, passwordHash: await hashPassword(temporaryPassword) }).returning();
    }
    await db
      .insert(memberships)
      .values({ userId: user.id, companyId: ctx.company.id, roleId: role.id })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.companyId], set: { roleId: role.id, active: true } });
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "users.member_added", entity: "user", entityId: user.id, after: { email: o.email, role: o.role } });
    revalidatePath("/empresa/definicoes");
    return { ok: true, message: temporaryPassword ? "Conta criada." : "Utilizador existente associado à empresa.", data: { temporaryPassword } };
  });
}

export async function changeRoleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("users.manage");
    const o = z.object({ membershipId: z.string().uuid(), role: z.enum([...assignable, "disabled"]) }).parse(formObject(fd));
    const [m] = await db.select({ m: memberships, role: roles.code }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.id, o.membershipId), eq(memberships.companyId, ctx.company.id))).limit(1);
    if (!m) throw new HttpError(404, "Membro não encontrado.");
    if (m.m.userId === ctx.user.id) throw new HttpError(403, "Não pode alterar o seu próprio papel.");
    if ((m.role === "owner" || o.role === "owner") && ctx.role !== "owner") throw new HttpError(403, "Só o proprietário pode alterar proprietários.");
    if (o.role === "disabled") {
      await db.update(memberships).set({ active: false }).where(eq(memberships.id, m.m.id));
    } else {
      const [role] = await db.select().from(roles).where(eq(roles.code, o.role)).limit(1);
      await db.update(memberships).set({ roleId: role.id, active: true }).where(eq(memberships.id, m.m.id));
    }
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "users.role_changed", entity: "membership", entityId: m.m.id, before: { role: m.role }, after: { role: o.role } });
    revalidatePath("/empresa/definicoes");
    return { ok: true, message: o.role === "disabled" ? "Acesso desactivado." : `Papel alterado para ${ROLES[o.role].name}.` };
  });
}
