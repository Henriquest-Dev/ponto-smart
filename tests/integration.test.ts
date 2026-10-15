/**
 * Testes de integração contra PostgreSQL + PostGIS (TEST_DATABASE_URL).
 * Cobrem: fluxo de marcação, idempotência, duplicados, isolamento entre
 * empresas, separação de funções e imutabilidade.
 */
import { sql, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { defaultCompanySettings } from "@/lib/db/schema";
import { clock, closeDay, reviewEvent } from "@/lib/domain/attendance";
import { classifyDay, createAbsenceRequest, decideAbsence } from "@/lib/domain/absence";
import { signQrToken } from "@/lib/domain/qr";
import { approveRun, closeAttendance, getOrCreatePeriod, prepareRun } from "@/lib/domain/payroll/service";
import { sha256 } from "@/lib/crypto";
import { provisionCompany } from "@/lib/domain/companies";
import { verifyPassword } from "@/lib/auth/password";
import { HttpError } from "@/lib/errors";
import { addDays, localDate, monthRange } from "@/lib/time";

const run = !!process.env.TEST_DATABASE_URL;
const TZ = "Africa/Maputo";

type Fixture = Awaited<ReturnType<typeof createCompany>>;

async function createCompany(name: string, lat: number, lng: number) {
  const [company] = await db.insert(s.companies).values({ name, status: "active" }).returning();
  const mk = async (email: string) =>
    (await db.insert(s.users).values({ email: `${email}.${company.id.slice(0, 6)}@test.example`, name: email, passwordHash: "x" }).returning())[0];
  const [empUser, hr, fin] = [await mk("emp"), await mk("hr"), await mk("fin")];
  const [dept] = await db.insert(s.departments).values({ companyId: company.id, name: "Ops" }).returning();
  const [employee] = await db
    .insert(s.employees)
    .values({ companyId: company.id, userId: empUser.id, employeeCode: "E1", fullName: "Teste Um", departmentId: dept.id, hireDate: "2025-01-01" })
    .returning();
  await db.insert(s.salaryAgreements).values({ companyId: company.id, employeeId: employee.id, amount: "20000.00", effectiveFrom: "2025-01-01" });
  const [schedule] = await db.insert(s.workSchedules).values({ companyId: company.id, name: "Seg-Dom", toleranceMinutes: 10 }).returning();
  await db.insert(s.scheduleRules).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ scheduleId: schedule.id, weekday, startTime: "08:00", endTime: "17:00", breakMinutes: 60 })));
  await db.insert(s.shiftAssignments).values({ companyId: company.id, employeeId: employee.id, scheduleId: schedule.id, validFrom: "2025-01-01" });
  const [location] = await db
    .insert(s.workLocations)
    .values({ companyId: company.id, name: "Sede", centerLat: lat, centerLng: lng, radiusM: 50, maxAccuracyM: 80, center: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography` as unknown as string })
    .returning();
  const [station] = await db.insert(s.attendanceStations).values({ companyId: company.id, locationId: location.id, name: "Recepção" }).returning();
  return { company, employee, empUser, hr, fin, station, location, lat, lng };
}

async function dynamicQr(f: Fixture) {
  const token = await signQrToken({ sid: f.station.id, cid: f.company.id, mode: "dynamic" }, 30);
  await db.insert(s.qrChallenges).values({ companyId: f.company.id, stationId: f.station.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 45_000) });
  return token;
}

const ctxFor = (f: Fixture) => ({ companyId: f.company.id, timeZone: TZ, settings: defaultCompanySettings, employeeId: f.employee.id, userId: f.empUser.id });
const at = (f: Fixture, extra: Partial<{ latitude: number; longitude: number; accuracy: number }> = {}) => ({
  latitude: f.lat, longitude: f.lng, accuracy: 10, deviceKey: null, ...extra,
});

/** O Drizzle embrulha o erro do PostgreSQL; a mensagem original está em `cause`. */
async function expectDbError(p: Promise<unknown>, re: RegExp) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    const err = e as { message?: string; cause?: { message?: string } };
    return re.test(`${err.message ?? ""} ${err.cause?.message ?? ""}`);
  });
}

async function expectHttp(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof HttpError && e.status === status);
}

describe.skipIf(!run)("integração (PostgreSQL + PostGIS)", () => {
  let A: Fixture;
  let B: Fixture;

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE companies, users RESTART IDENTITY CASCADE`);
    A = await createCompany("Empresa A", -25.966, 32.5786);
    B = await createCompany("Empresa B", -19.8436, 34.8389);
  });

  describe("marcação de ponto", () => {
    it("aceita dentro do perímetro, é idempotente e evita duplicados", async () => {
      const token = await dynamicQr(A);
      const key = crypto.randomUUID();
      const r1 = await clock(ctxFor(A), { token, ...at(A), idempotencyKey: key });
      expect(r1).toMatchObject({ status: "accepted", type: "in", geofence: "inside", duplicate: false });

      const again = await clock(ctxFor(A), { token, ...at(A), idempotencyKey: key });
      expect(again.eventId).toBe(r1.eventId);
      expect(again.duplicate).toBe(true);

      const dup = await clock(ctxFor(A), { token, ...at(A), idempotencyKey: crypto.randomUUID() });
      expect(dup.duplicate).toBe(true);
      expect(dup.eventId).toBe(r1.eventId);

      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.attendanceEvents).where(eq(s.attendanceEvents.employeeId, A.employee.id));
      expect(n).toBe(1);
    });

    it("rejeita fora do perímetro, mas permite pedir revisão", async () => {
      const token = await dynamicQr(A);
      const far = at(A, { latitude: -25.95, longitude: 32.6 });
      const r = await clock({ ...ctxFor(A), settings: { ...defaultCompanySettings, duplicateWindowMinutes: 0 } }, { token, ...far, idempotencyKey: crypto.randomUUID() });
      expect(r.status).toBe("rejected");
      expect(r.geofence).toBe("outside");
      const rv = await clock({ ...ctxFor(A), settings: { ...defaultCompanySettings, duplicateWindowMinutes: 0 } }, { token, ...far, idempotencyKey: crypto.randomUUID(), requestReview: true, reviewNote: "Estou no anexo" });
      expect(rv.status).toBe("review");
    });

    it("GPS impreciso nunca é tratado como fraude: fica em revisão", async () => {
      const token = await dynamicQr(B);
      const r = await clock(ctxFor(B), { token, ...at(B, { accuracy: 400 }), idempotencyKey: crypto.randomUUID() });
      expect(r.status).toBe("review");
      expect(r.geofence).toBe("inconclusive");
    });

    it("isolamento: QR da empresa A não serve a colaboradores da empresa B", async () => {
      const tokenA = await dynamicQr(A);
      await expectHttp(clock(ctxFor(B), { token: tokenA, ...at(A), idempotencyKey: crypto.randomUUID() }), 403);
    });

    it("rejeita QR adulterado ou não emitido pela estação", async () => {
      const notIssued = await signQrToken({ sid: A.station.id, cid: A.company.id, mode: "dynamic" }, 30);
      await expectHttp(clock(ctxFor(A), { token: notIssued, ...at(A), idempotencyKey: crypto.randomUUID() }), 400);
      await expectHttp(clock(ctxFor(A), { token: "q1.aaaa.bbbb", ...at(A), idempotencyKey: crypto.randomUUID() }), 400);
    });

    it("isolamento: não é possível rever marcações de outra empresa", async () => {
      const [ev] = await db.select().from(s.attendanceEvents).where(eq(s.attendanceEvents.employeeId, B.employee.id));
      await expectHttp(reviewEvent({ companyId: A.company.id, timeZone: TZ, eventId: ev.id, reviewerId: A.hr.id, decision: "accepted", reason: "teste" }), 404);
      await reviewEvent({ companyId: B.company.id, timeZone: TZ, eventId: ev.id, reviewerId: B.hr.id, decision: "accepted", reason: "Confirmado no local" });
    });
  });

  describe("justificações", () => {
    it("decisão por outra empresa é recusada; aprovação justifica a falta e guarda histórico", async () => {
      const day = addDays(localDate(new Date(), TZ), -3);
      await closeDay(A.company.id, day, TZ);
      const [daily] = await db.select().from(s.attendanceDaily).where(eq(s.attendanceDaily.workDate, day));
      expect(daily.status).toBe("absent_pending");

      const req = await createAbsenceRequest({ companyId: A.company.id, settings: { ...defaultCompanySettings, absenceFlow: "single" }, employeeId: A.employee.id, userId: A.empUser.id, startDate: day, endDate: day, type: "doenca", reason: "Atestado médico", files: [] });
      await expectHttp(decideAbsence({ companyId: B.company.id, requestId: req.id, userId: B.hr.id, role: "hr", decision: "approved", reason: "x".repeat(5), allowedEmployeeIds: null }), 404);
      await expectHttp(decideAbsence({ companyId: A.company.id, requestId: req.id, userId: A.empUser.id, role: "hr", decision: "approved", reason: "auto-aprovação", allowedEmployeeIds: null }), 403);
      await decideAbsence({ companyId: A.company.id, requestId: req.id, userId: A.hr.id, role: "hr", decision: "approved", reason: "Atestado verificado", allowedEmployeeIds: null });

      const [after] = await db.select().from(s.attendanceDaily).where(eq(s.attendanceDaily.id, daily.id));
      expect(after.status).toBe("justified");
      const adjustments = await db.select().from(s.attendanceAdjustments).where(eq(s.attendanceAdjustments.workDate, day));
      expect(adjustments[0].previous).toEqual({ status: "absent_pending" });
    });
  });

  describe("salários", () => {
    it("exige fecho de assiduidade, separação de funções e torna a execução imutável", async () => {
      const today = localDate(new Date(), TZ);
      const [y, m] = today.split("-").map(Number);
      const ctx = { companyId: A.company.id, userId: A.hr.id, currency: "MZN", dailyDivisor: 30 };
      const period = await getOrCreatePeriod(A.company.id, y, m);

      // Pendências bloqueiam o fecho
      const { from } = monthRange(y, m);
      const pendDay = from < addDays(today, -1) ? addDays(today, -1) : null;
      if (pendDay) {
        await closeDay(A.company.id, pendDay, TZ);
        await expectHttp(closeAttendance(ctx, period.id), 409);
        const pend = await db.select().from(s.attendanceDaily).where(sql`${s.attendanceDaily.companyId} = ${A.company.id} and ${s.attendanceDaily.status} in ('absent_pending','review','incomplete')`);
        for (const p of pend) await classifyDay({ companyId: A.company.id, dailyId: p.id, userId: A.hr.id, status: "unjustified", reason: "Sem justificação" });
      }
      // Marcações em revisão do mês também têm de estar resolvidas
      const reviews = await db.select().from(s.attendanceEvents).where(sql`${s.attendanceEvents.companyId} = ${A.company.id} and ${s.attendanceEvents.status} = 'review'`);
      for (const r of reviews) await reviewEvent({ companyId: A.company.id, timeZone: TZ, eventId: r.id, reviewerId: A.hr.id, decision: "accepted", reason: "ok" });
      const leftovers = await db.select().from(s.attendanceDaily).where(sql`${s.attendanceDaily.companyId} = ${A.company.id} and ${s.attendanceDaily.status} in ('absent_pending','review','incomplete')`);
      for (const p of leftovers) await classifyDay({ companyId: A.company.id, dailyId: p.id, userId: A.hr.id, status: "on_time", reason: "Regularizado" });

      await closeAttendance(ctx, period.id);
      const runRow = await prepareRun(ctx, period.id);
      expect(runRow.version).toBe(1);
      expect(Number(runRow.totals.net)).toBeGreaterThan(0);

      // Quem preparou não pode aprovar
      await expectHttp(approveRun(ctx, runRow.id), 403);
      // Outra empresa não encontra a execução
      await expectHttp(approveRun({ ...ctx, companyId: B.company.id, userId: B.fin.id }, runRow.id), 404);
      await approveRun({ ...ctx, userId: A.fin.id }, runRow.id);

      // Imutabilidade garantida pela base de dados
      await expectDbError(db.execute(sql`UPDATE payroll_lines SET amount = 1 WHERE company_id = ${A.company.id}`), /imutável/);
      await expectDbError(db.execute(sql`DELETE FROM payroll_items WHERE company_id = ${A.company.id}`), /imutável/);
    });

    it("Super Admin cria a conta da empresa com credenciais do proprietário", async () => {
      await db.insert(s.roles).values({ code: "owner", name: "Proprietário" }).onConflictDoNothing();
      const [plan] = await db.insert(s.subscriptionPlans).values({ code: `t-${Date.now()}`, name: "Teste", priceMonthly: "100.00", maxEmployees: 10 }).returning();
      const r = await provisionCompany({ name: "Nova Lda", planId: plan.id, ownerName: "Dona Nova", ownerEmail: `dona.${Date.now()}@test.example`, trialDays: 30 });
      expect(r.company.status).toBe("trial");
      expect(r.temporaryPassword).toBeTruthy();
      expect(await verifyPassword(r.temporaryPassword!, r.owner.passwordHash)).toBe(true);
      const [m] = await db.select({ role: s.roles.code }).from(s.memberships).innerJoin(s.roles, eq(s.roles.id, s.memberships.roleId)).where(eq(s.memberships.companyId, r.company.id));
      expect(m.role).toBe("owner");
      const [sub] = await db.select().from(s.subscriptions).where(eq(s.subscriptions.companyId, r.company.id));
      expect(sub.status).toBe("trialing");
    });

    it("trilho de auditoria é apenas de acréscimo", async () => {
      await db.insert(s.auditLogs).values({ companyId: A.company.id, action: "test", entity: "test" });
      await expectDbError(db.execute(sql`UPDATE audit_logs SET action = 'x'`), /acréscimo/);
      await expectDbError(db.execute(sql`DELETE FROM audit_logs`), /acréscimo/);
    });
  });
});
