import { and, asc, eq } from "drizzle-orm";
import { withCompany } from "@/lib/api";
import { db } from "@/lib/db";
import { branches, departments, employees } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { teamFilter } from "@/lib/queries/scope";

export const dynamic = "force-dynamic";

/** GET /api/reports/employees — lista de colaboradores (sem dados salariais). */
export const GET = withCompany(["reports.export"], async ({ ctx }) => {
  const rows = await db
    .select({ e: employees, department: departments.name, branch: branches.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(employees.companyId, ctx.company.id), teamFilter(ctx)))
    .orderBy(asc(employees.employeeCode));
  const buf = await buildWorkbook([
    {
      name: "Colaboradores",
      title: `${ctx.company.name} — Colaboradores`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Nome", key: "name", width: 28 }, { header: "Função", key: "job", width: 24 },
        { header: "Departamento", key: "department", width: 18 }, { header: "Filial", key: "branch", width: 18 }, { header: "Email", key: "email", width: 28 },
        { header: "Telefone", key: "phone", width: 16 }, { header: "Admissão", key: "hire", width: 12 }, { header: "Estado", key: "status", width: 12 },
      ],
      rows: rows.map((r) => ({
        code: r.e.employeeCode, name: r.e.fullName, job: r.e.jobTitle, department: r.department, branch: r.branch, email: r.e.email,
        phone: r.e.phone, hire: r.e.hireDate, status: r.e.status === "active" ? "Activo" : r.e.status === "inactive" ? "Inactivo" : "Cessado",
      })),
    },
  ]);
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "report.exported", entity: "employees" });
  return xlsxResponse(buf, "colaboradores.xlsx");
});
