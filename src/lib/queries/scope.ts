import "server-only";
import { inArray, sql, type SQL } from "drizzle-orm";
import { employees } from "@/lib/db/schema";
import type { AppContext } from "@/lib/auth/context";

/**
 * Restrição de equipa: supervisores só vêem colaboradores dos departamentos que gerem.
 * Devolve uma condição SQL sobre `employees` (ou undefined se não houver restrição).
 */
export function teamFilter(ctx: AppContext): SQL | undefined {
  if (ctx.teamDepartmentIds === null) return undefined;
  if (!ctx.teamDepartmentIds.length) return sql`false`;
  return inArray(employees.departmentId, ctx.teamDepartmentIds);
}
