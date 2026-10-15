import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  absenceDocuments,
  absenceRequests,
  approvalSteps,
  attendanceAdjustments,
  attendanceDaily,
  departments,
  employees,
  type CompanySettings,
} from "@/lib/db/schema";
import { HttpError } from "@/lib/errors";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_TOTAL_BYTES, putPrivateFile } from "@/lib/storage";
import { daysBetween } from "@/lib/time";
import { audit } from "./audit";
import { notifyRoles, notifyUsers } from "./notifications";

export const ABSENCE_TYPES: Record<string, string> = {
  doenca: "Doença",
  consulta: "Consulta médica",
  falecimento: "Falecimento de familiar",
  casamento: "Casamento",
  parentalidade: "Parentalidade",
  formacao: "Formação / exames",
  servico: "Serviço externo",
  outro: "Outro motivo",
};

export async function createAbsenceRequest(opts: {
  companyId: string;
  settings: CompanySettings;
  employeeId: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: string;
  reason: string;
  files: File[];
}) {
  if (opts.endDate < opts.startDate) throw new HttpError(422, "A data final não pode ser anterior à inicial.");
  if (!ABSENCE_TYPES[opts.type]) throw new HttpError(422, "Tipo de justificação inválido.");
  for (const f of opts.files) {
    if (!ALLOWED_UPLOAD_TYPES.includes(f.type)) throw new HttpError(422, `Formato não suportado: ${f.name}. Use PDF ou imagem.`);
    if (f.size > MAX_UPLOAD_BYTES) throw new HttpError(422, `${f.name} excede 4 MB.`);
  }
  if (opts.files.reduce((s, f) => s + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) throw new HttpError(422, "Os anexos excedem 5 MB no total.");
  if (opts.files.length > 3) throw new HttpError(422, "Máximo de 3 anexos por pedido.");

  // O supervisor só intervém se o departamento tiver responsável definido.
  const [emp] = await db
    .select({ managerUserId: departments.managerUserId, name: employees.fullName })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, opts.employeeId))
    .limit(1);
  const withSupervisor = opts.settings.absenceFlow === "supervisor_then_hr" && !!emp?.managerUserId;

  const request = await db.transaction(async (tx) => {
    const [req] = await tx
      .insert(absenceRequests)
      .values({
        companyId: opts.companyId,
        employeeId: opts.employeeId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        type: opts.type,
        reason: opts.reason,
        createdBy: opts.userId,
      })
      .returning();
    const steps = withSupervisor ? ["supervisor", "hr"] : ["hr"];
    await tx.insert(approvalSteps).values(
      steps.map((role, i) => ({ companyId: opts.companyId, requestId: req.id, stepOrder: i + 1, approverRole: role })),
    );
    return req;
  });

  for (const f of opts.files) {
    const key = `companies/${opts.companyId}/absences/${request.id}/${crypto.randomUUID()}`;
    await putPrivateFile(key, await f.arrayBuffer(), f.type);
    await db.insert(absenceDocuments).values({
      companyId: opts.companyId,
      requestId: request.id,
      storageKey: key,
      fileName: f.name.slice(0, 120),
      mimeType: f.type,
      sizeBytes: f.size,
      uploadedBy: opts.userId,
    });
  }

  await audit({ companyId: opts.companyId, actorId: opts.userId, action: "absence.created", entity: "absence_request", entityId: request.id, after: { startDate: opts.startDate, endDate: opts.endDate, type: opts.type } });
  if (withSupervisor && emp?.managerUserId) {
    await notifyUsers(opts.companyId, [emp.managerUserId], {
      kind: "absence", title: "Justificação para analisar", body: `${emp.name} submeteu uma justificação.`, link: "/empresa/justificacoes",
    });
  } else {
    await notifyRoles(opts.companyId, ["hr"], {
      kind: "absence", title: "Justificação para analisar", body: `${emp?.name ?? "Colaborador"} submeteu uma justificação.`, link: "/empresa/justificacoes",
    });
  }
  return request;
}

/** Decisão fundamentada sobre o passo pendente de um pedido. */
export async function decideAbsence(opts: {
  companyId: string;
  requestId: string;
  userId: string;
  role: "supervisor" | "hr";
  decision: "approved" | "rejected";
  reason: string;
  /** Para supervisores: colaboradores da equipa. */
  allowedEmployeeIds: string[] | null;
}) {
  if (opts.reason.trim().length < 3) throw new HttpError(422, "Indique o fundamento da decisão.");
  const [req] = await db
    .select({ req: absenceRequests, userId: employees.userId, name: employees.fullName })
    .from(absenceRequests)
    .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
    .where(and(eq(absenceRequests.id, opts.requestId), eq(absenceRequests.companyId, opts.companyId)))
    .limit(1);
  if (!req) throw new HttpError(404, "Pedido não encontrado.");
  if (req.req.status !== "pending") throw new HttpError(409, "Este pedido já foi decidido.");
  if (opts.allowedEmployeeIds && !opts.allowedEmployeeIds.includes(req.req.employeeId)) {
    throw new HttpError(403, "Este colaborador não pertence à sua equipa.");
  }
  if (req.userId === opts.userId) throw new HttpError(403, "Não pode decidir o seu próprio pedido.");

  const steps = await db.select().from(approvalSteps).where(eq(approvalSteps.requestId, req.req.id)).orderBy(asc(approvalSteps.stepOrder));
  const current = steps.find((s) => s.decision === "pending");
  if (!current) throw new HttpError(409, "Sem passos pendentes.");
  // RH pode decidir em qualquer passo (inclui substituir o supervisor); supervisor só no seu passo.
  if (opts.role === "supervisor" && current.approverRole !== "supervisor") {
    throw new HttpError(403, "Este pedido aguarda decisão do RH.");
  }

  const isFinal = opts.decision === "rejected" || current.stepOrder === steps[steps.length - 1].stepOrder || opts.role === "hr";
  await db.transaction(async (tx) => {
    await tx
      .update(approvalSteps)
      .set({ decision: opts.decision, approverId: opts.userId, reason: opts.reason, decidedAt: new Date() })
      .where(eq(approvalSteps.id, current.id));
    if (opts.role === "hr") {
      // Passos anteriores ainda pendentes ficam registados como ultrapassados pelo RH.
      for (const s of steps.filter((s) => s.decision === "pending" && s.id !== current.id && s.stepOrder < current.stepOrder)) {
        await tx.update(approvalSteps).set({ decision: "skipped", decidedAt: new Date() }).where(eq(approvalSteps.id, s.id));
      }
      for (const s of steps.filter((s) => s.decision === "pending" && s.id !== current.id && s.stepOrder > current.stepOrder)) {
        await tx.update(approvalSteps).set({ decision: "skipped", decidedAt: new Date(), reason: "Decidido pelo RH" }).where(eq(approvalSteps.id, s.id));
      }
    }
    if (!isFinal) return;
    await tx
      .update(absenceRequests)
      .set({ status: opts.decision, decidedAt: new Date(), decisionReason: opts.reason })
      .where(eq(absenceRequests.id, req.req.id));

    if (opts.decision === "approved") {
      // Recálculo do período: dias abrangidos passam a "justificada", guardando a versão anterior.
      const rows = await tx
        .select()
        .from(attendanceDaily)
        .where(and(eq(attendanceDaily.employeeId, req.req.employeeId), gte(attendanceDaily.workDate, req.req.startDate), lte(attendanceDaily.workDate, req.req.endDate)));
      for (const day of daysBetween(req.req.startDate, req.req.endDate)) {
        const row = rows.find((r) => r.workDate === day);
        if (row && (row.locked || !["absent_pending", "unjustified", "incomplete", "late"].includes(row.status))) continue;
        if (row) {
          await tx.update(attendanceDaily).set({ status: "justified", absenceRequestId: req.req.id, updatedAt: new Date() }).where(eq(attendanceDaily.id, row.id));
          await tx.insert(attendanceAdjustments).values({
            companyId: opts.companyId, employeeId: req.req.employeeId, workDate: day, authorId: opts.userId,
            reason: `Justificação aprovada: ${opts.reason}`, previous: { status: row.status }, next: { status: "justified", absenceRequestId: req.req.id },
          });
        }
      }
    }
  });

  await audit({
    companyId: opts.companyId, actorId: opts.userId, action: `absence.${isFinal ? opts.decision : "step_approved"}`,
    entity: "absence_request", entityId: req.req.id, after: { step: current.stepOrder, role: opts.role, reason: opts.reason },
  });
  if (isFinal && req.userId) {
    await notifyUsers(opts.companyId, [req.userId], {
      kind: "absence",
      title: opts.decision === "approved" ? "Justificação aprovada" : "Justificação recusada",
      body: opts.reason,
      link: "/app/justificacoes",
    });
  } else if (!isFinal) {
    await notifyRoles(opts.companyId, ["hr"], { kind: "absence", title: "Justificação validada pelo supervisor", body: `${req.name} — aguarda decisão do RH.`, link: "/empresa/justificacoes" });
  }
}

/** Classificação manual de um dia (ex.: falta injustificada) com histórico. */
export async function classifyDay(opts: {
  companyId: string;
  dailyId: string;
  userId: string;
  status: "unjustified" | "justified" | "on_time";
  reason: string;
  firstIn?: Date | null;
  lastOut?: Date | null;
}) {
  if (opts.reason.trim().length < 3) throw new HttpError(422, "Indique o motivo da correcção.");
  const [row] = await db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.id, opts.dailyId), eq(attendanceDaily.companyId, opts.companyId)))
    .limit(1);
  if (!row) throw new HttpError(404, "Registo não encontrado.");
  if (row.locked) throw new HttpError(409, "Período fechado. Reabra a assiduidade para corrigir.");
  const next: Record<string, unknown> = { status: opts.status };
  const patch: Partial<typeof attendanceDaily.$inferInsert> = { status: opts.status, updatedAt: new Date() };
  if (opts.firstIn !== undefined) { patch.firstIn = opts.firstIn; next.firstIn = opts.firstIn?.toISOString() ?? null; }
  if (opts.lastOut !== undefined) { patch.lastOut = opts.lastOut; next.lastOut = opts.lastOut?.toISOString() ?? null; }
  if (patch.firstIn && patch.lastOut) {
    const worked = Math.max(0, Math.round((patch.lastOut.getTime() - patch.firstIn.getTime()) / 60000) - row.breakMinutes);
    patch.workedMinutes = worked;
    next.workedMinutes = worked;
  }
  await db.transaction(async (tx) => {
    await tx.update(attendanceDaily).set(patch).where(eq(attendanceDaily.id, row.id));
    await tx.insert(attendanceAdjustments).values({
      companyId: opts.companyId, employeeId: row.employeeId, workDate: row.workDate, authorId: opts.userId, reason: opts.reason,
      previous: { status: row.status, firstIn: row.firstIn?.toISOString() ?? null, lastOut: row.lastOut?.toISOString() ?? null, workedMinutes: row.workedMinutes },
      next,
    });
  });
  await audit({ companyId: opts.companyId, actorId: opts.userId, action: "attendance.adjusted", entity: "attendance_daily", entityId: row.id, before: { status: row.status }, after: next });
}
