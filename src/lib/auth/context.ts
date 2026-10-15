import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { companies, departments, employees, memberships, roles, users, type CompanySettings } from "@/lib/db/schema";
import { readSessionRow } from "./session";
import { ROLES, isPrivilegedRole, isTeamScoped, type Permission, type RoleCode } from "./rbac";

export type AppContext = {
  sessionId: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; mfaEnabled: boolean };
  company: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
    status: string;
    settings: CompanySettings;
  } | null;
  role: RoleCode | null;
  permissions: Set<Permission>;
  employee: { id: string; fullName: string; employeeCode: string; departmentId: string | null; jobTitle: string | null } | null;
  /** Departamentos geridos (supervisores). `null` = sem restrição de equipa. */
  teamDepartmentIds: string[] | null;
  memberships: { companyId: string; companyName: string; role: RoleCode }[];
  /** MFA obrigatório pela política da empresa mas ainda não configurado. */
  mfaSetupRequired: boolean;
};

export const getContext = cache(async (): Promise<AppContext | null> => {
  const session = await readSessionRow();
  if (!session || session.mfaPending) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== "active") return null;

  const rows = await db
    .select({ companyId: companies.id, companyName: companies.name, role: roles.code })
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.active, true)));
  const list = rows.map((r) => ({ ...r, role: r.role as RoleCode }));

  const permissions = new Set<Permission>();
  if (user.isPlatformAdmin) ROLES.super_admin.permissions.forEach((p) => permissions.add(p as Permission));

  const active = list.find((m) => m.companyId === session.companyId) ?? list[0] ?? null;
  let company: AppContext["company"] = null;
  let employee: AppContext["employee"] = null;
  let teamDepartmentIds: string[] | null = null;
  let mfaSetupRequired = false;

  if (active) {
    const [c] = await db.select().from(companies).where(eq(companies.id, active.companyId)).limit(1);
    if (c && c.status !== "suspended" && c.status !== "cancelled") {
      company = { id: c.id, name: c.name, timezone: c.timezone, currency: c.currency, status: c.status, settings: c.settings };
      (ROLES[active.role].permissions as readonly Permission[]).forEach((p) => permissions.add(p));
      const [e] = await db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          employeeCode: employees.employeeCode,
          departmentId: employees.departmentId,
          jobTitle: employees.jobTitle,
          status: employees.status,
        })
        .from(employees)
        .where(and(eq(employees.companyId, c.id), eq(employees.userId, user.id)))
        .limit(1);
      if (e && e.status === "active") employee = e;
      if (isTeamScoped(active.role)) {
        const managed = await db
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.companyId, c.id), eq(departments.managerUserId, user.id)));
        teamDepartmentIds = managed.map((d) => d.id);
      }
      mfaSetupRequired = c.settings.requireMfaForAdmins && isPrivilegedRole(active.role) && !user.mfaEnabled;
    }
  }

  return {
    sessionId: session.id,
    user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin, mfaEnabled: user.mfaEnabled },
    company,
    role: company ? active!.role : null,
    permissions,
    employee,
    teamDepartmentIds,
    memberships: list,
    mfaSetupRequired,
  };
});

export function can(ctx: AppContext, ...perms: Permission[]): boolean {
  return perms.some((p) => ctx.permissions.has(p));
}

/** Para páginas e server actions: redirecciona quando não autenticado ou sem permissão. */
export async function requireContext(...anyOf: Permission[]): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (anyOf.length && !can(ctx, ...anyOf)) redirect("/sem-acesso");
  return ctx;
}

/** Contexto com empresa activa obrigatória. */
export async function requireCompany(...anyOf: Permission[]) {
  const ctx = await requireContext(...anyOf);
  if (!ctx.company) redirect("/sem-acesso");
  return ctx as AppContext & { company: NonNullable<AppContext["company"]> };
}

export async function requireEmployee() {
  const ctx = await requireCompany("self.clock");
  if (!ctx.employee) redirect("/sem-acesso?motivo=sem-ficha");
  return ctx as AppContext & {
    company: NonNullable<AppContext["company"]>;
    employee: NonNullable<AppContext["employee"]>;
  };
}

/** Destino por defeito após login, conforme o perfil. */
export function homeFor(ctx: AppContext): string {
  if (ctx.mfaSetupRequired) return "/conta/seguranca";
  if (ctx.role && ctx.role !== "employee") return "/empresa";
  if (ctx.employee) return "/app";
  if (ctx.user.isPlatformAdmin) return "/admin";
  return "/sem-acesso";
}
