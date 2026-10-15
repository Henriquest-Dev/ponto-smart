import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  absenceRequests,
  attendanceDaily,
  attendanceEvents,
  departments,
  employees,
  scheduleRules,
  shiftAssignments,
} from "@/lib/db/schema";
import type { AppContext } from "@/lib/auth/context";
import { addDays, isoWeekday, localDate } from "@/lib/time";
import { teamFilter } from "./scope";

type Ctx = AppContext & { company: NonNullable<AppContext["company"]> };

export async function todayBoard(ctx: Ctx) {
  const tz = ctx.company.timezone;
  const today = localDate(new Date(), tz);
  const weekday = isoWeekday(today);
  const staff = await db
    .select({
      id: employees.id,
      name: employees.fullName,
      code: employees.employeeCode,
      jobTitle: employees.jobTitle,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.status, "active"), teamFilter(ctx)))
    .orderBy(asc(employees.fullName));
  const ids = staff.map((s) => s.id);
  const daily = ids.length
    ? await db.select().from(attendanceDaily).where(and(inArray(attendanceDaily.employeeId, ids), eq(attendanceDaily.workDate, today)))
    : [];
  // Horário de hoje por colaborador (atribuição vigente).
  const rules = ids.length
    ? await db
        .select({ employeeId: shiftAssignments.employeeId, startTime: scheduleRules.startTime, endTime: scheduleRules.endTime })
        .from(shiftAssignments)
        .innerJoin(scheduleRules, and(eq(scheduleRules.scheduleId, shiftAssignments.scheduleId), eq(scheduleRules.weekday, weekday)))
        .where(and(inArray(shiftAssignments.employeeId, ids), lte(shiftAssignments.validFrom, today), sql`(${shiftAssignments.validTo} is null or ${shiftAssignments.validTo} >= ${today})`))
    : [];
  const rows = staff.map((s) => {
    const d = daily.find((x) => x.employeeId === s.id) ?? null;
    const r = rules.find((x) => x.employeeId === s.id) ?? null;
    return { ...s, daily: d, schedule: r ? `${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}` : null };
  });
  const scheduled = rows.filter((r) => r.schedule);
  return {
    today,
    rows,
    totals: {
      employees: rows.length,
      scheduled: scheduled.length,
      present: rows.filter((r) => r.daily?.firstIn).length,
      late: rows.filter((r) => r.daily?.status === "late").length,
      review: rows.filter((r) => r.daily?.status === "review").length,
    },
  };
}

export async function pendingCounts(ctx: Ctx) {
  const scope = teamFilter(ctx);
  const [abs] = await db
    .select({ n: count() })
    .from(absenceRequests)
    .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
    .where(and(eq(absenceRequests.companyId, ctx.company.id), eq(absenceRequests.status, "pending"), scope));
  const [rev] = await db
    .select({ n: count() })
    .from(attendanceEvents)
    .innerJoin(employees, eq(employees.id, attendanceEvents.employeeId))
    .where(and(eq(attendanceEvents.companyId, ctx.company.id), eq(attendanceEvents.status, "review"), scope));
  const [days] = await db
    .select({ n: count() })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .where(and(eq(attendanceDaily.companyId, ctx.company.id), inArray(attendanceDaily.status, ["absent_pending", "incomplete"]), eq(attendanceDaily.locked, false), scope));
  return { absences: abs.n, reviews: rev.n, days: days.n };
}

/** Série diária dos últimos N dias: presentes, atrasados, faltas. */
export async function attendanceSeries(ctx: Ctx, days = 30) {
  const today = localDate(new Date(), ctx.company.timezone);
  const from = addDays(today, -(days - 1));
  const rows = await db
    .select({
      date: attendanceDaily.workDate,
      present: sql<number>`count(*) filter (where ${attendanceDaily.firstIn} is not null)`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'late')`.mapWith(Number),
      absent: sql<number>`count(*) filter (where ${attendanceDaily.status} in ('absent_pending','unjustified'))`.mapWith(Number),
      justified: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'justified')`.mapWith(Number),
    })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .where(and(eq(attendanceDaily.companyId, ctx.company.id), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, today), teamFilter(ctx)))
    .groupBy(attendanceDaily.workDate)
    .orderBy(asc(attendanceDaily.workDate));
  const out = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const r = rows.find((x) => x.date === d);
    out.push({ date: d, present: r?.present ?? 0, late: r?.late ?? 0, absent: r?.absent ?? 0, justified: r?.justified ?? 0 });
  }
  return out;
}

/** Pontualidade por departamento (30 dias). */
export async function punctualityByDepartment(ctx: Ctx) {
  const today = localDate(new Date(), ctx.company.timezone);
  const from = addDays(today, -29);
  return db
    .select({
      department: sql<string>`coalesce(${departments.name}, 'Sem departamento')`,
      onTime: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'on_time')`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'late')`.mapWith(Number),
    })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(attendanceDaily.companyId, ctx.company.id), gte(attendanceDaily.workDate, from), teamFilter(ctx)))
    .groupBy(departments.name)
    .orderBy(desc(sql`count(*)`));
}
