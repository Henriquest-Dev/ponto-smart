import { and, asc, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withCompany } from "@/lib/api";
import { can } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { departments, employees } from "@/lib/db/schema";
import { createEmployee, employeeInput } from "@/lib/domain/employees";
import { teamFilter } from "@/lib/queries/scope";

export const dynamic = "force-dynamic";

/** GET /api/employees?q= — listar colaboradores (âmbito da empresa/equipa). */
export const GET = withCompany(["employees.view"], async ({ req, ctx }) => {
  const q = new URL(req.url).searchParams.get("q");
  const rows = await db
    .select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, email: employees.email, jobTitle: employees.jobTitle, department: departments.name, status: employees.status })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employees.companyId, ctx.company.id), teamFilter(ctx), q ? or(ilike(employees.fullName, `%${q}%`), ilike(employees.employeeCode, `%${q}%`)) : undefined))
    .orderBy(asc(employees.fullName))
    .limit(500);
  return NextResponse.json({ ok: true, employees: rows });
});

/** POST /api/employees — criar colaborador. */
export const POST = withCompany(["employees.manage"], async ({ req, ctx }) => {
  const input = employeeInput.parse(await req.json());
  const { employee, temporaryPassword } = await createEmployee({ companyId: ctx.company.id, actorId: ctx.user.id, canSetSalary: can(ctx, "employees.salary.view"), input });
  return NextResponse.json({ ok: true, employee: { id: employee.id, code: employee.employeeCode }, temporaryPassword }, { status: 201 });
});
