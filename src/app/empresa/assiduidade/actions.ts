"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { attendanceDaily } from "@/lib/db/schema";
import { can, requireCompany } from "@/lib/auth/context";
import { classifyDay } from "@/lib/domain/absence";
import { closeDay, employeesInDepartments, reviewEvent } from "@/lib/domain/attendance";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";
import { localDate, zonedToUtc } from "@/lib/time";

export async function reviewEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("attendance.manage", "absence.decide.team");
    const o = z.object({ eventId: z.string().uuid(), decision: z.enum(["accepted", "rejected"]), reason: z.string().min(3, "Indique o fundamento.") }).parse(formObject(fd));
    const allowed = can(ctx, "attendance.manage") ? null : await employeesInDepartments(ctx.company.id, ctx.teamDepartmentIds ?? []);
    const ev = await reviewEvent({ companyId: ctx.company.id, timeZone: ctx.company.timezone, eventId: o.eventId, reviewerId: ctx.user.id, decision: o.decision, reason: o.reason, allowedEmployeeIds: allowed });
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: `attendance.review_${o.decision}`, entity: "attendance_event", entityId: ev.id, after: { reason: o.reason } });
    revalidatePath("/empresa/assiduidade", "layout");
    return { ok: true, message: o.decision === "accepted" ? "Marcação validada." : "Marcação rejeitada." };
  });
}

export async function classifyDayAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("attendance.manage");
    const o = z
      .object({
        dailyId: z.string().uuid(),
        status: z.enum(["unjustified", "justified", "on_time"]),
        reason: z.string().min(3, "Indique o motivo."),
        firstIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        lastOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      })
      .parse(formObject(fd));
    const [row] = await db.select().from(attendanceDaily).where(and(eq(attendanceDaily.id, o.dailyId), eq(attendanceDaily.companyId, ctx.company.id))).limit(1);
    if (!row) throw new HttpError(404, "Registo não encontrado.");
    const tz = ctx.company.timezone;
    await classifyDay({
      companyId: ctx.company.id,
      dailyId: o.dailyId,
      userId: ctx.user.id,
      status: o.status,
      reason: o.reason,
      firstIn: o.firstIn ? zonedToUtc(row.workDate, o.firstIn, tz) : undefined,
      lastOut: o.lastOut ? zonedToUtc(row.workDate, o.lastOut, tz) : undefined,
    });
    revalidatePath("/empresa/assiduidade", "layout");
    return { ok: true, message: "Registo corrigido e histórico guardado." };
  });
}

export async function closeDayAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("attendance.manage");
    const date = String(fd.get("date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(422, "Data inválida.");
    if (date >= localDate(new Date(), ctx.company.timezone)) throw new HttpError(422, "Só é possível fechar dias já terminados.");
    const n = await closeDay(ctx.company.id, date, ctx.company.timezone);
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "attendance.day_closed", entity: "attendance_daily", after: { date, processed: n } });
    revalidatePath("/empresa/assiduidade", "layout");
    return { ok: true, message: `Dia consolidado (${n} colaboradores).` };
  });
}

