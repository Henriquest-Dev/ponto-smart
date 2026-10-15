import "server-only";
import { asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendanceDaily, attendanceEvents, billingInvoices, companies, companyRequests, employees, subscriptionPlans, subscriptions } from "@/lib/db/schema";

/** Métricas da plataforma — agregadas, sem dados salariais. */
export async function platformOverview() {
  const [companyRows, empCounts, events24h, subs, invoices] = await Promise.all([
    db.select().from(companies).orderBy(desc(companies.createdAt)),
    db.select({ companyId: employees.companyId, n: count() }).from(employees).where(eq(employees.status, "active")).groupBy(employees.companyId),
    db.select({ companyId: attendanceEvents.companyId, n: count() }).from(attendanceEvents).where(gte(attendanceEvents.occurredAt, new Date(Date.now() - 86400_000))).groupBy(attendanceEvents.companyId),
    db.select({ s: subscriptions, plan: subscriptionPlans }).from(subscriptions).innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId)),
    db.select({ i: billingInvoices, company: companies.name }).from(billingInvoices).innerJoin(companies, eq(companies.id, billingInvoices.companyId)).orderBy(desc(billingInvoices.issuedAt)),
  ]);
  const mrr = subs.filter((s) => s.s.status === "active").reduce((a, s) => a + Number(s.plan.priceMonthly), 0);
  const revenueByMonth = await db
    .select({ month: sql<string>`to_char(${billingInvoices.paidAt}, 'YYYY-MM')`, total: sql<number>`sum(${billingInvoices.amount})`.mapWith(Number) })
    .from(billingInvoices)
    .where(eq(billingInvoices.status, "paid"))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    companies: companyRows.map((c) => ({
      ...c,
      employees: empCounts.find((e) => e.companyId === c.id)?.n ?? 0,
      events24h: events24h.find((e) => e.companyId === c.id)?.n ?? 0,
      subscription: subs.find((s) => s.s.companyId === c.id) ?? null,
    })),
    mrr,
    invoices,
    revenueByMonth,
    totals: {
      active: companyRows.filter((c) => c.status === "active").length,
      trial: companyRows.filter((c) => c.status === "trial").length,
      employees: empCounts.reduce((a, e) => a + e.n, 0),
      events24h: events24h.reduce((a, e) => a + e.n, 0),
      openInvoices: invoices.filter((i) => i.i.status === "issued").length,
    },
  };
}

export async function pendingRequests() {
  return db
    .select({ r: companyRequests, plan: subscriptionPlans.name })
    .from(companyRequests)
    .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, companyRequests.planId))
    .where(eq(companyRequests.status, "pending"))
    .orderBy(asc(companyRequests.createdAt));
}

export async function pendingRequestCount() {
  const [{ n }] = await db.select({ n: count() }).from(companyRequests).where(eq(companyRequests.status, "pending"));
  return n;
}

/** Pontualidade e presença agregadas de todas as empresas (últimos 30 dias). */
export async function platformAttendanceTrend() {
  const from = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      date: attendanceDaily.workDate,
      onTime: sql<number>`count(*) filter (where ${attendanceDaily.status} in ('on_time','present'))`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'late')`.mapWith(Number),
      absent: sql<number>`count(*) filter (where ${attendanceDaily.status} in ('absent_pending','unjustified','justified'))`.mapWith(Number),
      scheduled: sql<number>`count(*) filter (where ${attendanceDaily.status} not in ('holiday','day_off'))`.mapWith(Number),
    })
    .from(attendanceDaily)
    .where(gte(attendanceDaily.workDate, from))
    .groupBy(attendanceDaily.workDate)
    .orderBy(asc(attendanceDaily.workDate));
  return rows
    .filter((r) => r.scheduled > 0)
    .map((r) => ({
      date: r.date,
      pontualidade: r.onTime + r.late ? Math.round((r.onTime / (r.onTime + r.late)) * 1000) / 10 : 0,
      presenca: Math.round(((r.scheduled - r.absent) / r.scheduled) * 1000) / 10,
    }));
}
