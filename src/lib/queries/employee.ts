import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  absenceDocuments,
  absenceRequests,
  approvalSteps,
  attendanceDaily,
  attendanceEvents,
  attendanceStations,
  attendanceValidations,
  payrollPeriods,
  payrollItems,
  payrollRuns,
  payslipAcknowledgements,
  payslips,
  salaryPayments,
} from "@/lib/db/schema";
import { scheduleFor } from "@/lib/domain/attendance";
import { localDate, monthRange } from "@/lib/time";

export async function currentState(companyId: string, employeeId: string) {
  const [last] = await db
    .select({ type: attendanceEvents.type, occurredAt: attendanceEvents.occurredAt, status: attendanceEvents.status, workDate: attendanceEvents.workDate })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.companyId, companyId),
        eq(attendanceEvents.employeeId, employeeId),
        ne(attendanceEvents.status, "rejected"),
        gte(attendanceEvents.occurredAt, new Date(Date.now() - 20 * 3600_000)),
      ),
    )
    .orderBy(desc(attendanceEvents.occurredAt))
    .limit(1);
  const state: "off" | "working" | "break" = !last || last.type === "out" ? "off" : last.type === "break_start" ? "break" : "working";
  return { state, last: last ?? null };
}

export async function todayOverview(companyId: string, employeeId: string, timeZone: string) {
  const today = localDate(new Date(), timeZone);
  const { state, last } = await currentState(companyId, employeeId);
  const workDate = state !== "off" && last ? last.workDate : today;
  const { schedule, rule } = await scheduleFor(db, employeeId, today);
  const events = await db
    .select({ id: attendanceEvents.id, type: attendanceEvents.type, occurredAt: attendanceEvents.occurredAt, status: attendanceEvents.status })
    .from(attendanceEvents)
    .where(and(eq(attendanceEvents.companyId, companyId), eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.workDate, workDate)))
    .orderBy(asc(attendanceEvents.occurredAt));
  const [daily] = await db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.employeeId, employeeId), eq(attendanceDaily.workDate, workDate)))
    .limit(1);
  return { today, workDate, state, last, schedule, rule, events, daily: daily ?? null };
}

export async function monthDays(companyId: string, employeeId: string, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  return db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.companyId, companyId), eq(attendanceDaily.employeeId, employeeId), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to)))
    .orderBy(desc(attendanceDaily.workDate));
}

export function summarize(days: (typeof attendanceDaily.$inferSelect)[]) {
  const worked = days.filter((d) => d.workedMinutes > 0 || d.firstIn);
  const scheduled = days.filter((d) => !["holiday", "day_off"].includes(d.status));
  const late = days.filter((d) => d.status === "late").length;
  const onTime = days.filter((d) => d.status === "on_time").length;
  return {
    workedDays: worked.length,
    workedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
    overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
    late,
    absences: days.filter((d) => ["absent_pending", "unjustified"].includes(d.status)).length,
    pending: days.filter((d) => ["absent_pending", "incomplete", "review"].includes(d.status)).length,
    justified: days.filter((d) => d.status === "justified").length,
    punctuality: onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 1000) / 10 : null,
    scheduledDays: scheduled.length,
  };
}

export async function monthEvents(companyId: string, employeeId: string, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  return db
    .select({
      id: attendanceEvents.id,
      type: attendanceEvents.type,
      occurredAt: attendanceEvents.occurredAt,
      workDate: attendanceEvents.workDate,
      status: attendanceEvents.status,
      reason: attendanceEvents.reason,
      station: attendanceStations.name,
      geofence: attendanceValidations.geofenceResult,
      accuracy: attendanceValidations.accuracyM,
    })
    .from(attendanceEvents)
    .leftJoin(attendanceStations, eq(attendanceStations.id, attendanceEvents.stationId))
    .leftJoin(attendanceValidations, eq(attendanceValidations.eventId, attendanceEvents.id))
    .where(and(eq(attendanceEvents.companyId, companyId), eq(attendanceEvents.employeeId, employeeId), gte(attendanceEvents.workDate, from), lte(attendanceEvents.workDate, to)))
    .orderBy(asc(attendanceEvents.occurredAt));
}

export async function myAbsences(companyId: string, employeeId: string) {
  const requests = await db
    .select()
    .from(absenceRequests)
    .where(and(eq(absenceRequests.companyId, companyId), eq(absenceRequests.employeeId, employeeId)))
    .orderBy(desc(absenceRequests.createdAt))
    .limit(50);
  const ids = requests.map((r) => r.id);
  const steps = ids.length ? await db.select().from(approvalSteps).where(inArray(approvalSteps.requestId, ids)).orderBy(asc(approvalSteps.stepOrder)) : [];
  const docs = ids.length
    ? await db.select({ id: absenceDocuments.id, requestId: absenceDocuments.requestId, fileName: absenceDocuments.fileName }).from(absenceDocuments).where(inArray(absenceDocuments.requestId, ids))
    : [];
  return requests.map((r) => ({ ...r, steps: steps.filter((s) => s.requestId === r.id), documents: docs.filter((d) => d.requestId === r.id) }));
}

export async function unjustifiedDays(companyId: string, employeeId: string) {
  return db
    .select({ id: attendanceDaily.id, workDate: attendanceDaily.workDate, status: attendanceDaily.status })
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.companyId, companyId), eq(attendanceDaily.employeeId, employeeId), inArray(attendanceDaily.status, ["absent_pending", "incomplete", "late"]), eq(attendanceDaily.locked, false)))
    .orderBy(desc(attendanceDaily.workDate))
    .limit(10);
}

export async function myPayslips(companyId: string, employeeId: string) {
  const rows = await db
    .select({
      id: payslips.id,
      reference: payslips.reference,
      issuedAt: payslips.issuedAt,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      gross: payrollItems.gross,
      deductions: payrollItems.deductions,
      net: payrollItems.net,
      currency: payrollItems.currency,
      itemId: payrollItems.id,
      acknowledgedAt: payslipAcknowledgements.acknowledgedAt,
    })
    .from(payslips)
    .innerJoin(payrollItems, eq(payrollItems.id, payslips.payrollItemId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .leftJoin(payslipAcknowledgements, eq(payslipAcknowledgements.payslipId, payslips.id))
    .where(and(eq(payslips.companyId, companyId), eq(payslips.employeeId, employeeId)))
    .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month));
  const itemIds = rows.map((r) => r.itemId);
  const payments = itemIds.length ? await db.select().from(salaryPayments).where(inArray(salaryPayments.payrollItemId, itemIds)) : [];
  return rows.map((r) => ({ ...r, payments: payments.filter((p) => p.payrollItemId === r.itemId) }));
}
