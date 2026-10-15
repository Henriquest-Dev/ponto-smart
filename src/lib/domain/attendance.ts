import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attendanceDaily,
  attendanceEvents,
  attendanceStations,
  attendanceValidations,
  employees,
  holidays,
  qrChallenges,
  scheduleRules,
  shiftAssignments,
  trustedDevices,
  workLocations,
  workSchedules,
  absenceRequests,
  type CompanySettings,
} from "@/lib/db/schema";
import { HttpError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { isoWeekday, localDate } from "@/lib/time";
import { decideGeofence, type GeofenceResult } from "./geofence";
import { verifyQrToken } from "./qr";
import { buildDayPlan, computeDay, nextEventType, type EventType } from "./attendance-rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/* ------------------------------------------------------------------ */
/* Horário aplicável                                                   */
/* ------------------------------------------------------------------ */

export async function scheduleFor(ex: Executor, employeeId: string, workDate: string) {
  const [assignment] = await ex
    .select({ schedule: workSchedules })
    .from(shiftAssignments)
    .innerJoin(workSchedules, eq(workSchedules.id, shiftAssignments.scheduleId))
    .where(
      and(
        eq(shiftAssignments.employeeId, employeeId),
        lte(shiftAssignments.validFrom, workDate),
        or(isNull(shiftAssignments.validTo), gte(shiftAssignments.validTo, workDate)),
      ),
    )
    .orderBy(desc(shiftAssignments.validFrom))
    .limit(1);
  if (!assignment) return { schedule: null, rule: null };
  const [rule] = await ex
    .select()
    .from(scheduleRules)
    .where(and(eq(scheduleRules.scheduleId, assignment.schedule.id), eq(scheduleRules.weekday, isoWeekday(workDate))))
    .limit(1);
  return { schedule: assignment.schedule, rule: rule ?? null };
}

export async function isHoliday(ex: Executor, companyId: string, workDate: string) {
  const rows = await ex
    .select({ id: holidays.id })
    .from(holidays)
    .where(
      and(
        eq(holidays.companyId, companyId),
        or(
          eq(holidays.date, workDate),
          and(eq(holidays.recurring, true), sql`to_char(${holidays.date}, 'MM-DD') = ${workDate.slice(5)}`),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Consolidação diária                                                 */
/* ------------------------------------------------------------------ */

export async function recomputeDaily(ex: Executor, companyId: string, employeeId: string, workDate: string, timeZone: string) {
  const [existing] = await ex
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.employeeId, employeeId), eq(attendanceDaily.workDate, workDate)))
    .limit(1);
  if (existing?.locked) return existing;

  const { schedule, rule } = await scheduleFor(ex, employeeId, workDate);
  const holiday = await isHoliday(ex, companyId, workDate);
  const plan = buildDayPlan(
    workDate,
    rule ? { startTime: rule.startTime, endTime: rule.endTime, breakMinutes: rule.breakMinutes } : null,
    schedule?.toleranceMinutes ?? 0,
    schedule?.timezone ?? timeZone,
    holiday,
  );

  const events = await ex
    .select({ type: attendanceEvents.type, occurredAt: attendanceEvents.occurredAt, status: attendanceEvents.status })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.companyId, companyId),
        eq(attendanceEvents.employeeId, employeeId),
        eq(attendanceEvents.workDate, workDate),
        ne(attendanceEvents.status, "rejected"),
      ),
    )
    .orderBy(asc(attendanceEvents.occurredAt));

  const today = localDate(new Date(), timeZone);
  const dayIsOver = workDate < today;
  const keepStatus =
    existing && (existing.status === "justified" || existing.status === "unjustified") ? existing.status : null;

  // Sem marcações hoje ainda: não criar registo (não é falta até o dia terminar).
  if (!events.length && !dayIsOver && !existing) return null;

  const computed = computeDay(
    events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, status: e.status as "accepted" | "review" })),
    plan,
    { dayIsOver, keepStatus },
  );

  const values = {
    companyId,
    employeeId,
    workDate,
    scheduleId: schedule?.id ?? null,
    expectedStart: plan.expectedStart,
    expectedEnd: plan.expectedEnd,
    ...computed,
    updatedAt: new Date(),
  };
  const [row] = await ex
    .insert(attendanceDaily)
    .values(values)
    .onConflictDoUpdate({ target: [attendanceDaily.employeeId, attendanceDaily.workDate], set: values })
    .returning();
  return row;
}

/**
 * Fecho do dia: cria "falta pendente" para quem tinha horário e não marcou,
 * e marca registos abertos como incompletos. Idempotente.
 */
export async function closeDay(companyId: string, workDate: string, timeZone: string) {
  const staff = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.status, "active")));
  let processed = 0;
  for (const e of staff) {
    const { rule } = await scheduleFor(db, e.id, workDate);
    const [existing] = await db
      .select({ id: attendanceDaily.id })
      .from(attendanceDaily)
      .where(and(eq(attendanceDaily.employeeId, e.id), eq(attendanceDaily.workDate, workDate)))
      .limit(1);
    if (!rule && !existing) continue;
    const row = await recomputeDaily(db, companyId, e.id, workDate, timeZone);
    // Ausência aprovada que cobre o dia → justificada.
    if (row && row.status === "absent_pending") {
      const [approved] = await db
        .select({ id: absenceRequests.id })
        .from(absenceRequests)
        .where(
          and(
            eq(absenceRequests.employeeId, e.id),
            eq(absenceRequests.status, "approved"),
            lte(absenceRequests.startDate, workDate),
            gte(absenceRequests.endDate, workDate),
          ),
        )
        .limit(1);
      if (approved) {
        await db
          .update(attendanceDaily)
          .set({ status: "justified", absenceRequestId: approved.id, updatedAt: new Date() })
          .where(eq(attendanceDaily.id, row.id));
      }
    }
    processed++;
  }
  return processed;
}

/* ------------------------------------------------------------------ */
/* Marcação de ponto                                                   */
/* ------------------------------------------------------------------ */

export type ClockInput = {
  token: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  deviceKey: string | null;
  idempotencyKey: string;
  requested?: "break_start" | "break_end" | null;
  requestReview?: boolean;
  reviewNote?: string | null;
};

export type ClockResult = {
  eventId: string;
  type: EventType;
  status: "accepted" | "review" | "rejected";
  occurredAt: string;
  geofence: GeofenceResult;
  device: "trusted" | "unknown" | "revoked" | "not_required";
  message: string;
  duplicate: boolean;
};

type ClockCtx = {
  companyId: string;
  timeZone: string;
  settings: CompanySettings;
  employeeId: string;
  userId: string;
};

export async function clock(ctx: ClockCtx, input: ClockInput): Promise<ClockResult> {
  // 0) Idempotência: o mesmo pedido repetido devolve o mesmo resultado.
  const prior = await findByIdempotency(ctx, input.idempotencyKey);
  if (prior) return { ...prior, duplicate: true };

  // 1) Token do QR assinado e válido no servidor.
  const verification = await verifyQrToken(input.token);
  if (!verification.ok) {
    throw new HttpError(
      400,
      verification.reason === "expired"
        ? "O QR Code expirou. Leia novamente o código apresentado na estação."
        : "QR Code inválido para o PontoSmart.",
      `qr_${verification.reason}`,
    );
  }
  const { sid, cid, mode } = verification.claims;
  // Isolamento multi-empresa: o QR tem de pertencer à empresa do colaborador.
  if (cid !== ctx.companyId) throw new HttpError(403, "Este QR Code pertence a outra empresa.", "qr_foreign");

  const [station] = await db
    .select({ station: attendanceStations, location: workLocations })
    .from(attendanceStations)
    .innerJoin(workLocations, eq(workLocations.id, attendanceStations.locationId))
    .where(and(eq(attendanceStations.id, sid), eq(attendanceStations.companyId, ctx.companyId)))
    .limit(1);
  if (!station || !station.station.active || !station.location.active) {
    throw new HttpError(400, "Estação de marcação inactiva ou inexistente.", "station_inactive");
  }
  const tokenHash = sha256(input.token);
  if (mode === "dynamic") {
    if (station.station.qrMode !== "dynamic") throw new HttpError(400, "QR Code inválido para esta estação.", "qr_invalid");
    const [challenge] = await db
      .select({ id: qrChallenges.id })
      .from(qrChallenges)
      .where(and(eq(qrChallenges.tokenHash, tokenHash), eq(qrChallenges.stationId, sid)))
      .limit(1);
    if (!challenge) throw new HttpError(400, "QR Code não reconhecido. Leia novamente.", "qr_unknown");
  } else if (station.station.qrMode !== "static" || station.station.staticTokenHash !== tokenHash) {
    throw new HttpError(400, "QR Code fixo revogado ou inválido.", "qr_revoked");
  }

  // 2) Geofence em PostGIS (polígono, se existir; senão raio).
  let distanceOutsideM: number | null = null;
  let centerDistanceM: number | null = null;
  if (input.latitude !== null && input.longitude !== null) {
    const rows = await db.execute<{ outside: number; center: number }>(sql`
      WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography AS g)
      SELECT
        CASE WHEN l.geom IS NOT NULL
             THEN CASE WHEN ST_Covers(l.geom, p.g) THEN 0 ELSE ST_Distance(l.geom, p.g) END
             ELSE ST_Distance(l.center, p.g) - l.radius_m END AS outside,
        ST_Distance(l.center, p.g) AS center
      FROM work_locations l, p
      WHERE l.id = ${station.location.id}
    `);
    distanceOutsideM = Number(rows[0]?.outside);
    centerDistanceM = Number(rows[0]?.center);
  }
  const geo = decideGeofence({
    distanceOutsideM,
    accuracyM: input.accuracy,
    maxAccuracyM: station.location.maxAccuracyM,
  });

  // 3) Dispositivo de confiança (factor adicional, não prova infalível numa PWA).
  let device: ClockResult["device"] = "not_required";
  let deviceId: string | null = null;
  if (ctx.settings.devicePolicy !== "off") {
    device = "unknown";
    if (input.deviceKey) {
      const [d] = await db
        .select()
        .from(trustedDevices)
        .where(and(eq(trustedDevices.employeeId, ctx.employeeId), eq(trustedDevices.credentialId, sha256(input.deviceKey))))
        .limit(1);
      if (d) {
        device = d.revokedAt ? "revoked" : "trusted";
        deviceId = d.id;
      }
    }
  }

  // 4) Estado final.
  let status: ClockResult["status"] = "accepted";
  const reasons: string[] = [];
  if (geo.result === "outside") {
    if (input.requestReview) {
      status = "review";
      reasons.push("Fora do perímetro — revisão pedida pelo colaborador.");
    } else {
      status = "rejected";
    }
  } else if (geo.result !== "inside") {
    status = "review";
    reasons.push(geo.message);
  }
  if (ctx.settings.devicePolicy === "require" && device !== "trusted" && status === "accepted") {
    status = "review";
    reasons.push("Dispositivo não reconhecido como de confiança.");
  }
  if (input.reviewNote) reasons.push(`Nota do colaborador: ${input.reviewNote.slice(0, 300)}`);

  // 5) Gravação atómica com bloqueio por colaborador (evita duplicados em concorrência).
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.employeeId}))`);

    const again = await findByIdempotency(ctx, input.idempotencyKey, tx);
    if (again) return { ...again, duplicate: true };

    const now = new Date();
    const [last] = await tx
      .select({ id: attendanceEvents.id, type: attendanceEvents.type, occurredAt: attendanceEvents.occurredAt, workDate: attendanceEvents.workDate, status: attendanceEvents.status })
      .from(attendanceEvents)
      .where(
        and(
          eq(attendanceEvents.companyId, ctx.companyId),
          eq(attendanceEvents.employeeId, ctx.employeeId),
          ne(attendanceEvents.status, "rejected"),
          gte(attendanceEvents.occurredAt, new Date(now.getTime() - 20 * 3600_000)),
        ),
      )
      .orderBy(desc(attendanceEvents.occurredAt))
      .limit(1);

    // Prevenção de duplicados: segunda leitura dentro da janela não gera novo evento.
    const windowMs = ctx.settings.duplicateWindowMinutes * 60_000;
    if (last && status !== "rejected" && now.getTime() - last.occurredAt.getTime() < windowMs) {
      return {
        eventId: last.id,
        type: last.type,
        status: last.status,
        occurredAt: last.occurredAt.toISOString(),
        geofence: geo.result,
        device,
        message: "Marcação já registada há instantes. Não foi criada nova marcação.",
        duplicate: true,
      } satisfies ClockResult;
    }

    const type = nextEventType(last?.type ?? null, input.requested);
    // Entrada abre um novo dia de trabalho; as restantes pertencem ao turno aberto (inclui turnos nocturnos).
    const workDate = type === "in" || !last ? localDate(now, ctx.timeZone) : last.workDate;

    const [event] = await tx
      .insert(attendanceEvents)
      .values({
        companyId: ctx.companyId,
        employeeId: ctx.employeeId,
        stationId: station.station.id,
        locationId: station.location.id,
        type,
        occurredAt: now,
        workDate,
        status,
        source: mode === "dynamic" ? "qr_dynamic" : "qr_static",
        idempotencyKey: input.idempotencyKey,
        deviceId,
        reason: status === "rejected" ? geo.message : reasons.join(" ") || null,
      })
      .returning();

    await tx.insert(attendanceValidations).values({
      companyId: ctx.companyId,
      eventId: event.id,
      qrMode: mode,
      tokenValid: true,
      // Minimização: coordenadas guardadas apenas no momento da marcação, arredondadas (~1 m).
      latitude: input.latitude !== null ? Math.round(input.latitude * 1e5) / 1e5 : null,
      longitude: input.longitude !== null ? Math.round(input.longitude * 1e5) / 1e5 : null,
      accuracyM: input.accuracy,
      distanceM: centerDistanceM,
      geofenceResult: geo.result,
      deviceResult: device,
      details: { maxAccuracyM: station.location.maxAccuracyM, radiusM: station.location.radiusM, devicePolicy: ctx.settings.devicePolicy },
    });

    if (deviceId) await tx.update(trustedDevices).set({ lastUsedAt: now }).where(eq(trustedDevices.id, deviceId));
    if (status !== "rejected") await recomputeDaily(tx, ctx.companyId, ctx.employeeId, workDate, ctx.timeZone);

    const message =
      status === "accepted"
        ? type === "in"
          ? "Entrada registada."
          : type === "out"
            ? "Saída registada."
            : type === "break_start"
              ? "Início de intervalo registado."
              : "Fim de intervalo registado."
        : status === "review"
          ? "Marcação registada e enviada para revisão."
          : geo.message;

    return {
      eventId: event.id,
      type,
      status,
      occurredAt: now.toISOString(),
      geofence: geo.result,
      device,
      message,
      duplicate: false,
    } satisfies ClockResult;
  });

  return result;
}

async function findByIdempotency(ctx: ClockCtx, key: string, ex: Executor = db): Promise<Omit<ClockResult, "duplicate"> | null> {
  const [row] = await ex
    .select({ event: attendanceEvents, validation: attendanceValidations })
    .from(attendanceEvents)
    .leftJoin(attendanceValidations, eq(attendanceValidations.eventId, attendanceEvents.id))
    .where(
      and(
        eq(attendanceEvents.companyId, ctx.companyId),
        eq(attendanceEvents.employeeId, ctx.employeeId),
        eq(attendanceEvents.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    eventId: row.event.id,
    type: row.event.type,
    status: row.event.status,
    occurredAt: row.event.occurredAt.toISOString(),
    geofence: row.validation?.geofenceResult ?? "unavailable",
    device: row.validation?.deviceResult ?? "not_required",
    message: "Pedido já processado.",
  };
}

/** Revisão autorizada de uma marcação em revisão. */
export async function reviewEvent(opts: {
  companyId: string;
  timeZone: string;
  eventId: string;
  reviewerId: string;
  decision: "accepted" | "rejected";
  reason: string;
  allowedEmployeeIds?: string[] | null;
}) {
  const [event] = await db
    .select()
    .from(attendanceEvents)
    .where(and(eq(attendanceEvents.id, opts.eventId), eq(attendanceEvents.companyId, opts.companyId)))
    .limit(1);
  if (!event) throw new HttpError(404, "Marcação não encontrada.");
  if (opts.allowedEmployeeIds && !opts.allowedEmployeeIds.includes(event.employeeId)) {
    throw new HttpError(403, "Fora da sua equipa.");
  }
  if (event.status !== "review") throw new HttpError(409, "Esta marcação já foi revista.");
  await db.transaction(async (tx) => {
    await tx
      .update(attendanceEvents)
      .set({
        status: opts.decision,
        reviewedBy: opts.reviewerId,
        reviewedAt: new Date(),
        reason: [event.reason, `Revisão: ${opts.reason}`].filter(Boolean).join(" "),
      })
      .where(eq(attendanceEvents.id, event.id));
    await recomputeDaily(tx, opts.companyId, event.employeeId, event.workDate, opts.timeZone);
  });
  return event;
}

export async function employeesInDepartments(companyId: string, departmentIds: string[]) {
  if (!departmentIds.length) return [];
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.companyId, companyId), inArray(employees.departmentId, departmentIds)));
  return rows.map((r) => r.id);
}
