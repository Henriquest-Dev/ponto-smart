"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { holidays, scheduleRules, workSchedules } from "@/lib/db/schema";
import { requireCompany } from "@/lib/auth/context";
import { audit } from "@/lib/domain/audit";
import { runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";

const time = z.string().regex(/^\d{2}:\d{2}$/);

export async function saveScheduleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("schedules.manage");
    const name = String(fd.get("name") ?? "").trim();
    const tolerance = Number(fd.get("toleranceMinutes") ?? 10);
    const id = String(fd.get("id") ?? "");
    if (name.length < 3) throw new HttpError(422, "Indique o nome do horário.");
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 120) throw new HttpError(422, "Tolerância entre 0 e 120 minutos.");
    const rules: { weekday: number; startTime: string; endTime: string; breakMinutes: number }[] = [];
    for (let wd = 1; wd <= 7; wd++) {
      if (fd.get(`on_${wd}`) !== "on") continue;
      const startTime = time.parse(fd.get(`start_${wd}`));
      const endTime = time.parse(fd.get(`end_${wd}`));
      const breakMinutes = Number(fd.get(`break_${wd}`) ?? 0);
      if (startTime === endTime) throw new HttpError(422, "Hora de início e fim não podem ser iguais.");
      rules.push({ weekday: wd, startTime, endTime, breakMinutes: Math.max(0, Math.min(240, breakMinutes || 0)) });
    }
    if (!rules.length) throw new HttpError(422, "Seleccione pelo menos um dia de trabalho.");
    const scheduleId = await db.transaction(async (tx) => {
      let sid = id;
      if (sid) {
        const [s] = await tx.select().from(workSchedules).where(and(eq(workSchedules.id, sid), eq(workSchedules.companyId, ctx.company.id))).limit(1);
        if (!s) throw new HttpError(404, "Horário não encontrado.");
        await tx.update(workSchedules).set({ name, toleranceMinutes: tolerance }).where(eq(workSchedules.id, sid));
        await tx.delete(scheduleRules).where(eq(scheduleRules.scheduleId, sid));
      } else {
        const [s] = await tx.insert(workSchedules).values({ companyId: ctx.company.id, name, toleranceMinutes: tolerance, timezone: ctx.company.timezone }).returning();
        sid = s.id;
      }
      await tx.insert(scheduleRules).values(rules.map((r) => ({ ...r, scheduleId: sid })));
      return sid;
    });
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: id ? "schedule.updated" : "schedule.created", entity: "work_schedule", entityId: scheduleId, after: { name, tolerance, rules } });
    revalidatePath("/empresa/horarios");
    return { ok: true, message: "Horário guardado. Aplica-se aos dias ainda não fechados." };
  });
}

export async function addHolidayAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("schedules.manage");
    const o = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(3), recurring: z.string().optional() }).parse(Object.fromEntries(fd));
    await db.insert(holidays).values({ companyId: ctx.company.id, date: o.date, name: o.name, recurring: o.recurring === "on" }).onConflictDoNothing();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "holiday.created", entity: "holiday", after: o });
    revalidatePath("/empresa/horarios");
    return { ok: true, message: "Feriado adicionado." };
  });
}

export async function removeHolidayAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("schedules.manage");
    await db.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "holiday.removed", entity: "holiday", entityId: id });
    revalidatePath("/empresa/horarios");
    return { ok: true, message: "Feriado removido." };
  });
}
