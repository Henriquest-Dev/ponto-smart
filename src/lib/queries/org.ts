import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, departments, workSchedules } from "@/lib/db/schema";

export async function orgOptions(companyId: string) {
  const [d, b, s] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, companyId)).orderBy(asc(departments.name)),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.companyId, companyId)).orderBy(asc(branches.name)),
    db.select({ id: workSchedules.id, name: workSchedules.name }).from(workSchedules).where(eq(workSchedules.companyId, companyId)).orderBy(asc(workSchedules.name)),
  ]);
  return { departments: d, branches: b, schedules: s };
}

export type OrgOptions = Awaited<ReturnType<typeof orgOptions>>;
