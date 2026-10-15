/**
 * Dados fictícios de demonstração. Todos os nomes, NUIT, contactos e valores são inventados.
 * Executar: npm run db:seed   (idempotente apenas sobre base vazia — use npm run db:reset)
 */
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlClient } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { PERMISSIONS, ROLES, type RoleCode } from "@/lib/auth/rbac";
import { addDays, isoWeekday, localDate, monthRange, zonedToUtc } from "@/lib/time";
import { closeDay, reviewEvent } from "@/lib/domain/attendance";
import { classifyDay, createAbsenceRequest, decideAbsence } from "@/lib/domain/absence";
import { approveRun, closeAttendance, getOrCreatePeriod, issuePayslips, prepareRun, registerPayment } from "@/lib/domain/payroll/service";
import { sha256 } from "@/lib/crypto";

const TZ = "Africa/Maputo";
const DEMO_PASSWORD = "PontoSmart2026";

// PRNG determinístico (mulberry32) para dados reproduzíveis.
let seed = 20261015;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

async function syncRbac() {
  for (const [code, p] of Object.entries(PERMISSIONS)) {
    await db.insert(s.permissions).values({ code, module: p.module, description: p.description }).onConflictDoNothing();
  }
  const perms = await db.select().from(s.permissions);
  const roleIds: Record<string, string> = {};
  for (const [code, r] of Object.entries(ROLES)) {
    const [role] = await db
      .insert(s.roles)
      .values({ code, name: r.name, description: r.description })
      .onConflictDoUpdate({ target: s.roles.code, set: { name: r.name, description: r.description } })
      .returning();
    roleIds[code] = role.id;
    await db.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, role.id));
    const ids = perms.filter((p) => (r.permissions as readonly string[]).includes(p.code)).map((p) => p.id);
    if (ids.length) await db.insert(s.rolePermissions).values(ids.map((permissionId) => ({ roleId: role.id, permissionId })));
  }
  return roleIds as Record<RoleCode, string>;
}

async function user(email: string, name: string, extra: Partial<typeof s.users.$inferInsert> = {}) {
  const [u] = await db
    .insert(s.users)
    .values({ email, name, passwordHash: await hashPassword(DEMO_PASSWORD), ...extra })
    .returning();
  return u;
}

async function main() {
  const [{ count }] = await sqlClient()`select count(*)::int as count from companies`;
  if (count > 0) {
    console.log("A base de dados já tem dados. Use `npm run db:reset` para recomeçar.");
    return;
  }
  console.log("A criar papéis e permissões…");
  const roleIds = await syncRbac();

  /* ---------------------------- Plataforma ---------------------------- */
  await user("admin@pontosmart.co.mz", "Equipa PontoSmart", { isPlatformAdmin: true });
  const plans = await db
    .insert(s.subscriptionPlans)
    .values([
      { code: "essencial", name: "Essencial", priceMonthly: "2500.00", maxEmployees: 25, modules: ["ponto", "assiduidade", "justificacoes"] },
      { code: "profissional", name: "Profissional", priceMonthly: "7500.00", maxEmployees: 100, modules: ["ponto", "assiduidade", "justificacoes", "salarios", "relatorios"] },
      { code: "empresarial", name: "Empresarial", priceMonthly: "22000.00", maxEmployees: 500, modules: ["ponto", "assiduidade", "justificacoes", "salarios", "relatorios", "ia", "multi_filial"] },
    ])
    .returning();

  // Regras legais globais — deliberadamente SEM taxas: requerem validação profissional.
  await db.insert(s.payrollRuleVersions).values([
    {
      ruleCode: "INSS_TRAB", name: "Contribuição INSS (trabalhador)", version: 1,
      params: { kind: "employee_contribution", ratePercent: null, note: "Preencher com a taxa vigente verificada por especialista." },
      effectiveFrom: "2020-01-01", validated: false, sourceReference: "A confirmar — legislação de segurança social obrigatória",
    },
    {
      ruleCode: "INSS_ENT", name: "Contribuição INSS (entidade empregadora)", version: 1,
      params: { kind: "employer_contribution", ratePercent: null, note: "Encargo da empresa; não desconta ao colaborador." },
      effectiveFrom: "2020-01-01", validated: false, sourceReference: "A confirmar",
    },
    {
      ruleCode: "IRPS", name: "IRPS — retenção na fonte", version: 1,
      params: { kind: "income_tax", brackets: [], note: "Inserir tabela de retenção vigente validada." },
      effectiveFrom: "2020-01-01", validated: false, sourceReference: "A confirmar — tabela de retenção do IRPS",
    },
  ]);

  /* ------------------------------ Empresa A ----------------------------- */
  console.log("A criar empresa de demonstração…");
  const [company] = await db
    .insert(s.companies)
    .values({
      name: "Mahotas Logística",
      legalName: "Mahotas Logística, Lda. (fictícia)",
      nuit: "400000001",
      email: "geral@mahotas.example",
      phone: "+258 84 000 0001",
      address: "Av. 24 de Julho, Maputo",
      status: "active",
    })
    .returning();
  const cid = company.id;

  const [sede, matola] = await db
    .insert(s.branches)
    .values([
      { companyId: cid, name: "Sede", address: "Av. 24 de Julho", city: "Maputo" },
      { companyId: cid, name: "Armazém da Matola", address: "Estrada Nacional 4", city: "Matola" },
    ])
    .returning();

  const owner = await user("dono@mahotas.example", "Rui Mabjaia");
  const hr = await user("rh@mahotas.example", "Celeste Nhaca");
  const finance = await user("financeiro@mahotas.example", "Aurélio Cumbane");
  const supervisor = await user("supervisor@mahotas.example", "Tomás Bambo");

  const [operacoes, administrativo, armazem] = await db
    .insert(s.departments)
    .values([
      { companyId: cid, branchId: sede.id, name: "Operações", managerUserId: supervisor.id },
      { companyId: cid, branchId: sede.id, name: "Administrativo" },
      { companyId: cid, branchId: matola.id, name: "Armazém", managerUserId: supervisor.id },
    ])
    .returning();

  await db.insert(s.memberships).values([
    { userId: owner.id, companyId: cid, roleId: roleIds.owner },
    { userId: hr.id, companyId: cid, roleId: roleIds.hr },
    { userId: finance.id, companyId: cid, roleId: roleIds.finance },
    { userId: supervisor.id, companyId: cid, roleId: roleIds.supervisor },
  ]);

  const [admin, warehouse, night] = await db
    .insert(s.workSchedules)
    .values([
      { companyId: cid, name: "Administrativo (seg–sex)", toleranceMinutes: 10 },
      { companyId: cid, name: "Armazém (seg–sáb)", toleranceMinutes: 10 },
      { companyId: cid, name: "Segurança nocturna", toleranceMinutes: 15 },
    ])
    .returning();
  await db.insert(s.scheduleRules).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({ scheduleId: admin.id, weekday, startTime: "08:00", endTime: "17:00", breakMinutes: 60 })),
    ...[1, 2, 3, 4, 5].map((weekday) => ({ scheduleId: warehouse.id, weekday, startTime: "07:00", endTime: "16:00", breakMinutes: 60 })),
    { scheduleId: warehouse.id, weekday: 6, startTime: "07:00", endTime: "12:00", breakMinutes: 0 },
    ...[1, 2, 3, 4, 5].map((weekday) => ({ scheduleId: night.id, weekday, startTime: "22:00", endTime: "06:00", breakMinutes: 30 })),
  ]);

  // Feriados nacionais de Moçambique (recorrentes) — confirmar calendário oficial anual.
  await db.insert(s.holidays).values(
    [
      ["2026-01-01", "Dia da Fraternidade Universal"],
      ["2026-02-03", "Dia dos Heróis Moçambicanos"],
      ["2026-04-07", "Dia da Mulher Moçambicana"],
      ["2026-05-01", "Dia Internacional dos Trabalhadores"],
      ["2026-06-25", "Dia da Independência Nacional"],
      ["2026-09-07", "Dia da Vitória"],
      ["2026-09-25", "Dia das Forças Armadas"],
      ["2026-10-04", "Dia da Paz e Reconciliação"],
      ["2026-12-25", "Dia da Família"],
    ].map(([date, name]) => ({ companyId: cid, date, name, recurring: true })),
  );

  const point = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;
  const [locSede, locArmazem] = await db
    .insert(s.workLocations)
    .values([
      { companyId: cid, branchId: sede.id, name: "Sede — Av. 24 de Julho", centerLat: -25.966, centerLng: 32.5786, radiusM: 60, maxAccuracyM: 80, center: point(-25.966, 32.5786) },
      { companyId: cid, branchId: matola.id, name: "Armazém da Matola", centerLat: -25.9622, centerLng: 32.4589, radiusM: 120, maxAccuracyM: 100, center: point(-25.9622, 32.4589) },
    ])
    .returning();
  const [stSede, stArmazem] = await db
    .insert(s.attendanceStations)
    .values([
      { companyId: cid, locationId: locSede.id, name: "Recepção da Sede", qrMode: "dynamic", rotationSeconds: 30 },
      { companyId: cid, locationId: locArmazem.id, name: "Portaria do Armazém", qrMode: "dynamic", rotationSeconds: 30 },
    ])
    .returning();

  // Rubricas
  const [subTransporte, subAlimentacao, adiantamento] = await db
    .insert(s.payrollComponents)
    .values([
      { companyId: cid, code: "SUB_TRANSP", name: "Subsídio de transporte", nature: "earning", calcType: "fixed", rate: "1500", taxable: true, effectiveFrom: "2026-01-01" },
      { companyId: cid, code: "SUB_ALIM", name: "Subsídio de alimentação", nature: "earning", calcType: "fixed", rate: "2000", taxable: true, effectiveFrom: "2026-01-01" },
      { companyId: cid, code: "ADIANT", name: "Reembolso de adiantamento", nature: "deduction", calcType: "fixed", rate: null, taxable: false, effectiveFrom: "2026-01-01" },
      // Multiplicador de demonstração — confirmar com especialista laboral antes de uso real.
      { companyId: cid, code: "HORAS_EXTRA", name: "Horas extraordinárias (pressuposto 1,5×)", nature: "earning", calcType: "per_hour", rate: "1.5", taxable: true, effectiveFrom: "2026-01-01" },
    ])
    .returning();

  /* ---------------------------- Colaboradores --------------------------- */
  type Seed = { name: string; email: string; title: string; dept: typeof operacoes; branch: typeof sede; schedule: typeof admin; salary: string; role?: RoleCode; userId?: string };
  const people: Seed[] = [
    { name: "Ana Cossa", email: "colaborador@mahotas.example", title: "Assistente de operações", dept: operacoes, branch: sede, schedule: admin, salary: "28500.00" },
    { name: "Carlos Sitoe", email: "carlos.sitoe@mahotas.example", title: "Coordenador logístico", dept: operacoes, branch: sede, schedule: admin, salary: "54000.00" },
    { name: "Dércio Nhantumbo", email: "dercio.n@mahotas.example", title: "Motorista", dept: operacoes, branch: sede, schedule: admin, salary: "22000.00" },
    { name: "Elsa Macuácua", email: "elsa.m@mahotas.example", title: "Técnica administrativa", dept: administrativo, branch: sede, schedule: admin, salary: "31000.00" },
    { name: "Félix Chambal", email: "felix.c@mahotas.example", title: "Contabilista", dept: administrativo, branch: sede, schedule: admin, salary: "62000.00" },
    { name: "Graça Tembe", email: "graca.t@mahotas.example", title: "Recepcionista", dept: administrativo, branch: sede, schedule: admin, salary: "19500.00" },
    { name: "Hélio Mabunda", email: "helio.m@mahotas.example", title: "Fiel de armazém", dept: armazem, branch: matola, schedule: warehouse, salary: "24000.00" },
    { name: "Inês Muianga", email: "ines.m@mahotas.example", title: "Operadora de empilhador", dept: armazem, branch: matola, schedule: warehouse, salary: "21500.00" },
    { name: "Jorge Langa", email: "jorge.l@mahotas.example", title: "Ajudante de armazém", dept: armazem, branch: matola, schedule: warehouse, salary: "16500.00" },
    { name: "Lurdes Bila", email: "lurdes.b@mahotas.example", title: "Conferente", dept: armazem, branch: matola, schedule: warehouse, salary: "18800.00" },
    { name: "Mário Zandamela", email: "mario.z@mahotas.example", title: "Vigilante", dept: armazem, branch: matola, schedule: night, salary: "17500.00" },
    { name: "Nélia Cumbe", email: "nelia.c@mahotas.example", title: "Técnica de RH", dept: administrativo, branch: sede, schedule: admin, salary: "36000.00", userId: hr.id },
    { name: "Tomás Bambo", email: "supervisor@mahotas.example", title: "Supervisor de operações", dept: operacoes, branch: sede, schedule: admin, salary: "48000.00", userId: supervisor.id },
  ];
  // RH e supervisor também são colaboradores (marcam ponto).
  people[11].name = hr.name;
  people[11].email = hr.email;

  const today = localDate(new Date(), TZ);
  const [ty, tm] = today.split("-").map(Number);
  const m2 = tm <= 2 ? { y: ty - 1, m: tm + 10 } : { y: ty, m: tm - 2 };
  const m1 = tm === 1 ? { y: ty - 1, m: 12 } : { y: ty, m: tm - 1 };
  const historyFrom = monthRange(m2.y, m2.m).from;

  const emps: (typeof s.employees.$inferSelect)[] = [];
  for (const [i, p] of people.entries()) {
    const u = p.userId ? { id: p.userId } : await user(p.email, p.name);
    if (!p.userId) await db.insert(s.memberships).values({ userId: u.id, companyId: cid, roleId: roleIds.employee });
    const [e] = await db
      .insert(s.employees)
      .values({
        companyId: cid, userId: u.id, employeeCode: `MHL-${String(101 + i).padStart(4, "0")}`, fullName: p.name, email: p.email,
        phone: `+258 84 ${String(1000000 + i * 7919).slice(0, 3)} ${String(1000 + i * 37).slice(0, 4)}`, jobTitle: p.title,
        departmentId: p.dept.id, branchId: p.branch.id, hireDate: "2024-03-01", nuit: `1${String(10000000 + i * 1234567).slice(0, 8)}`,
      })
      .returning();
    emps.push(e);
    await db.insert(s.employmentContracts).values({ companyId: cid, employeeId: e.id, type: i % 4 === 3 ? "determinado" : "indeterminado", startDate: "2024-03-01", weeklyHours: p.schedule.id === warehouse.id ? 45 : 40 });
    await db.insert(s.salaryAgreements).values({ companyId: cid, employeeId: e.id, amount: p.salary, effectiveFrom: "2024-03-01", createdBy: owner.id });
    await db.insert(s.shiftAssignments).values({ companyId: cid, employeeId: e.id, scheduleId: p.schedule.id, validFrom: "2024-03-01" });
    await db.insert(s.employeeComponents).values({ companyId: cid, employeeId: e.id, componentId: subTransporte.id, amount: "1500.00", effectiveFrom: "2026-01-01" });
    if (p.dept.id !== armazem.id) {
      await db.insert(s.employeeComponents).values({ companyId: cid, employeeId: e.id, componentId: subAlimentacao.id, amount: "2000.00", effectiveFrom: "2026-01-01" });
    }
  }
  await db.insert(s.employeeComponents).values({ companyId: cid, employeeId: emps[2].id, componentId: adiantamento.id, amount: "3000.00", effectiveFrom: monthRange(m1.y, m1.m).from, effectiveTo: monthRange(m1.y, m1.m).to, note: "Adiantamento autorizado por escrito" });

  // Dispositivo de confiança da colaboradora de demonstração (o identificador real é criado no telemóvel).
  await db.insert(s.trustedDevices).values({ companyId: cid, employeeId: emps[0].id, credentialId: sha256("demo-device"), label: "Telemóvel pessoal (demo)" });

  /* ------------------------------ Marcações ----------------------------- */
  console.log("A gerar histórico de marcações…");
  const holidaySet = new Set((await db.select().from(s.holidays).where(eq(s.holidays.companyId, cid))).map((h) => h.date.slice(5)));
  const rules = await db.select().from(s.scheduleRules);
  const absences: { emp: number; date: string; kind: "justify" | "unjustified" | "pending" }[] = [];
  const reviews: string[] = [];
  const events: (typeof s.attendanceEvents.$inferInsert)[] = [];
  const validations: { idx: number; lat: number; lng: number; acc: number; result: "inside" | "inconclusive" }[] = [];

  for (let d = historyFrom; d <= today; d = addDays(d, 1)) {
    if (holidaySet.has(d.slice(5))) continue;
    for (const [i, e] of emps.entries()) {
      const p = people[i];
      const rule = rules.find((r) => r.scheduleId === p.schedule.id && r.weekday === isoWeekday(d));
      if (!rule) continue;
      const start = Number(rule.startTime.slice(0, 2)) * 60 + Number(rule.startTime.slice(3, 5));
      let end = Number(rule.endTime.slice(0, 2)) * 60 + Number(rule.endTime.slice(3, 5));
      if (end <= start) end += 24 * 60;
      const isToday = d === today;
      const roll = rand();
      if (!isToday && roll < 0.035) {
        const kind = d < monthRange(ty, tm).from ? (rand() < 0.6 ? "justify" : "unjustified") : "pending";
        absences.push({ emp: i, date: d, kind });
        continue;
      }
      const late = roll < 0.15;
      const inMin = start + (late ? between(12, 38) : between(-12, 7));
      const outMin = end + between(-3, rand() < 0.2 ? 75 : 20);
      const loc = p.branch.id === sede.id ? locSede : locArmazem;
      const station = p.branch.id === sede.id ? stSede : stArmazem;
      const review = !isToday && rand() < 0.02;
      const nowMin = Number(localDateTime().slice(0, 2)) * 60 + Number(localDateTime().slice(3, 5));
      const add = (type: "in" | "out" | "break_start" | "break_end", minutes: number, status: "accepted" | "review" = "accepted") => {
        const dayOffset = Math.floor(minutes / (24 * 60));
        const occurredAt = zonedToUtc(addDays(d, dayOffset), hhmm(minutes % (24 * 60)), TZ);
        if (occurredAt > new Date()) return;
        events.push({
          companyId: cid, employeeId: e.id, stationId: station.id, locationId: loc.id, type, occurredAt, workDate: d, status,
          source: "qr_dynamic", idempotencyKey: crypto.randomUUID(), reason: status === "review" ? "Precisão GPS insuficiente (±140 m). Revisão necessária." : null,
        });
        validations.push({
          idx: events.length - 1,
          lat: Number(loc.centerLat) + (rand() - 0.5) * 0.0004,
          lng: Number(loc.centerLng) + (rand() - 0.5) * 0.0004,
          acc: status === "review" ? 140 : between(6, 35),
          result: status === "review" ? "inconclusive" : "inside",
        });
      };
      add("in", inMin, review ? "review" : "accepted");
      if (review) reviews.push(`${e.id}|${d}`);
      if (rule.breakMinutes > 0 && rand() < 0.5) {
        const b = start + Math.floor((end - start) / 2) - 30;
        add("break_start", b);
        add("break_end", b + rule.breakMinutes + between(-5, 5));
      }
      if (!isToday || outMin < nowMin) {
        // Alguns registos incompletos no mês corrente (saída em falta).
        if (!isToday && d >= monthRange(ty, tm).from && rand() < 0.015) continue;
        add("out", outMin);
      }
    }
  }
  const inserted: { id: string }[] = [];
  for (let i = 0; i < events.length; i += 500) {
    inserted.push(...(await db.insert(s.attendanceEvents).values(events.slice(i, i + 500)).returning({ id: s.attendanceEvents.id })));
  }
  const vals = validations.map((v) => ({
    companyId: cid, eventId: inserted[v.idx].id, qrMode: "dynamic" as const, tokenValid: true,
    latitude: Math.round(v.lat * 1e5) / 1e5, longitude: Math.round(v.lng * 1e5) / 1e5, accuracyM: v.acc,
    distanceM: between(3, 45), geofenceResult: v.result, deviceResult: "not_required" as const,
  }));
  for (let i = 0; i < vals.length; i += 500) await db.insert(s.attendanceValidations).values(vals.slice(i, i + 500));

  console.log("A consolidar assiduidade diária…");
  for (let d = historyFrom; d <= today; d = addDays(d, 1)) {
    await closeDay(cid, d, TZ);
  }

  // Revisões de marcações dos meses anteriores (decididas pelo supervisor).
  const reviewRows = await db.select().from(s.attendanceEvents).where(and(eq(s.attendanceEvents.companyId, cid), eq(s.attendanceEvents.status, "review")));
  for (const ev of reviewRows) {
    if (ev.workDate >= monthRange(ty, tm).from) continue;
    await reviewEvent({ companyId: cid, timeZone: TZ, eventId: ev.id, reviewerId: supervisor.id, decision: "accepted", reason: "Presença confirmada pelo supervisor no local." });
  }

  console.log("A criar justificações…");
  const settings = company.settings;
  for (const a of absences) {
    const e = emps[a.emp];
    const uid = e.userId!;
    if (a.kind === "unjustified") {
      const [row] = await db.select().from(s.attendanceDaily).where(and(eq(s.attendanceDaily.employeeId, e.id), eq(s.attendanceDaily.workDate, a.date)));
      if (row) await classifyDay({ companyId: cid, dailyId: row.id, userId: hr.id, status: "unjustified", reason: "Sem justificação apresentada no prazo." });
      continue;
    }
    const type = ["doenca", "consulta", "falecimento", "formacao"][between(0, 3)];
    const req = await createAbsenceRequest({
      companyId: cid, settings, employeeId: e.id, userId: uid, startDate: a.date, endDate: a.date, type,
      reason: type === "doenca" ? "Indisposição com atestado médico." : type === "consulta" ? "Consulta marcada no Hospital Central." : type === "falecimento" ? "Cerimónias fúnebres de familiar." : "Exame da universidade.",
      files: [],
    });
    if (a.kind === "justify") {
      if (people[a.emp].dept.managerUserId && e.userId !== supervisor.id) {
        await decideAbsence({ companyId: cid, requestId: req.id, userId: supervisor.id, role: "supervisor", decision: "approved", reason: "Confirmo a ausência.", allowedEmployeeIds: null });
      }
      if (e.userId !== hr.id) {
        await decideAbsence({ companyId: cid, requestId: req.id, userId: hr.id, role: "hr", decision: "approved", reason: "Documento comprovativo verificado.", allowedEmployeeIds: null });
      } else {
        await decideAbsence({ companyId: cid, requestId: req.id, userId: owner.id, role: "hr", decision: "approved", reason: "Documento comprovativo verificado.", allowedEmployeeIds: null });
      }
    }
  }

  // Pendências de meses fechados que não tenham sido resolvidas (ex.: incompletos).
  for (const period of [m2, m1]) {
    const { from, to } = monthRange(period.y, period.m);
    const pend = await db
      .select()
      .from(s.attendanceDaily)
      .where(and(eq(s.attendanceDaily.companyId, cid), inArray(s.attendanceDaily.status, ["absent_pending", "incomplete", "review"])));
    for (const row of pend.filter((r) => r.workDate >= from && r.workDate <= to)) {
      await classifyDay({ companyId: cid, dailyId: row.id, userId: hr.id, status: row.status === "absent_pending" ? "unjustified" : "on_time", reason: "Regularização do período." });
    }
  }

  /* ----------------------------- Salários ------------------------------- */
  console.log("A processar salários de demonstração…");
  const hrCtx = { companyId: cid, userId: hr.id, currency: "MZN", dailyDivisor: settings.payrollDailyDivisor };
  const finCtx = { ...hrCtx, userId: finance.id };
  const p2 = await getOrCreatePeriod(cid, m2.y, m2.m);
  await closeAttendance(hrCtx, p2.id);
  const run2 = await prepareRun(hrCtx, p2.id);
  await approveRun(finCtx, run2.id);
  await issuePayslips(finCtx, run2.id);
  const items = await db.select().from(s.payrollItems).where(eq(s.payrollItems.runId, run2.id));
  const { to: m2End } = monthRange(m2.y, m2.m);
  for (const it of items) {
    await registerPayment(finCtx, { payrollItemId: it.id, amount: it.net, paidAt: addDays(m2End, 0), method: "transferencia", reference: `TRF-${it.id.slice(0, 8).toUpperCase()}` });
  }
  const slips = await db.select().from(s.payslips).where(eq(s.payslips.runId, run2.id));
  for (const slip of slips.slice(0, 6)) {
    await db.insert(s.payslipAcknowledgements).values({ companyId: cid, payslipId: slip.id, employeeId: slip.employeeId });
  }
  await db.update(s.payrollPeriods).set({ status: "closed", closedAt: new Date() }).where(eq(s.payrollPeriods.id, p2.id));

  const p1 = await getOrCreatePeriod(cid, m1.y, m1.m);
  await closeAttendance(hrCtx, p1.id);
  await prepareRun(hrCtx, p1.id);
  await getOrCreatePeriod(cid, ty, tm);

  /* --------------------------- Empresa B (isolamento) ---------------------------- */
  const [companyB] = await db
    .insert(s.companies)
    .values({ name: "Beira Serviços Técnicos", legalName: "Beira Serviços Técnicos, SA (fictícia)", nuit: "400000002", address: "Rua Major Serpa Pinto, Beira", status: "trial" })
    .returning();
  const ownerB = await user("dono@beira.example", "Sara Mussa");
  await db.insert(s.memberships).values({ userId: ownerB.id, companyId: companyB.id, roleId: roleIds.owner });
  const [deptB] = await db.insert(s.departments).values({ companyId: companyB.id, name: "Manutenção" }).returning();
  for (const [i, n] of ["Bento Simango", "Rita Chiziane", "Zito Guambe"].entries()) {
    await db.insert(s.employees).values({ companyId: companyB.id, employeeCode: `BST-${i + 1}`, fullName: n, departmentId: deptB.id, jobTitle: "Técnico de manutenção" });
  }
  await db.insert(s.workLocations).values({ companyId: companyB.id, name: "Oficina da Beira", centerLat: -19.8436, centerLng: 34.8389, radiusM: 80, center: point(-19.8436, 34.8389) });

  /* -------------------------------- SaaS -------------------------------- */
  const [subA] = await db
    .insert(s.subscriptions)
    .values({ companyId: cid, planId: plans[1].id, status: "active", currentPeriodStart: monthRange(ty, tm).from, currentPeriodEnd: monthRange(ty, tm).to })
    .returning();
  const [subB] = await db
    .insert(s.subscriptions)
    .values({ companyId: companyB.id, planId: plans[0].id, status: "trialing", currentPeriodStart: today, currentPeriodEnd: addDays(today, 30) })
    .returning();
  await db.insert(s.billingInvoices).values([
    { companyId: cid, subscriptionId: subA.id, number: `PS-${m2.y}-${String(m2.m).padStart(2, "0")}-001`, amount: "7500.00", status: "paid", issuedAt: monthRange(m2.y, m2.m).from, dueAt: addDays(monthRange(m2.y, m2.m).from, 15), paidAt: addDays(monthRange(m2.y, m2.m).from, 6) },
    { companyId: cid, subscriptionId: subA.id, number: `PS-${m1.y}-${String(m1.m).padStart(2, "0")}-001`, amount: "7500.00", status: "paid", issuedAt: monthRange(m1.y, m1.m).from, dueAt: addDays(monthRange(m1.y, m1.m).from, 15), paidAt: addDays(monthRange(m1.y, m1.m).from, 9) },
    { companyId: cid, subscriptionId: subA.id, number: `PS-${ty}-${String(tm).padStart(2, "0")}-001`, amount: "7500.00", status: "issued", issuedAt: monthRange(ty, tm).from, dueAt: addDays(monthRange(ty, tm).from, 15) },
    { companyId: companyB.id, subscriptionId: subB.id, number: `PS-${ty}-${String(tm).padStart(2, "0")}-002`, amount: "0.00", status: "draft", issuedAt: today, dueAt: addDays(today, 30) },
  ]);

  console.log("\nDados de demonstração criados. Palavra-passe de todas as contas:", DEMO_PASSWORD);
  console.table([
    { perfil: "Super Admin", email: "admin@pontosmart.co.mz" },
    { perfil: "Proprietário", email: "dono@mahotas.example" },
    { perfil: "RH", email: "rh@mahotas.example" },
    { perfil: "Financeiro", email: "financeiro@mahotas.example" },
    { perfil: "Supervisor", email: "supervisor@mahotas.example" },
    { perfil: "Colaborador", email: "colaborador@mahotas.example" },
    { perfil: "Outra empresa", email: "dono@beira.example" },
  ]);
}

function localDateTime() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

main()
  .then(() => sqlClient().end())
  .catch(async (err) => {
    console.error(err);
    await sqlClient().end();
    process.exit(1);
  });
