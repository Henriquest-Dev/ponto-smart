"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "@/lib/db";
import { attendanceStations, workLocations } from "@/lib/db/schema";
import { requireCompany } from "@/lib/auth/context";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/lib/domain/audit";
import { signQrToken } from "@/lib/domain/qr";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";
import { headers } from "next/headers";

const locationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Indique o nome do local."),
  branchId: z.string().uuid().optional(),
  centerLat: z.coerce.number().min(-90).max(90),
  centerLng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(5, "Raio mínimo 5 m.").max(5000),
  maxAccuracyM: z.coerce.number().int().min(10).max(500),
});

export async function saveLocationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("locations.manage");
    const o = locationSchema.parse(formObject(fd));
    const center = sql`ST_SetSRID(ST_MakePoint(${o.centerLng}, ${o.centerLat}), 4326)::geography` as unknown as string;
    const values = { name: o.name, branchId: o.branchId ?? null, centerLat: o.centerLat, centerLng: o.centerLng, radiusM: o.radiusM, maxAccuracyM: o.maxAccuracyM, center };
    let id = o.id;
    if (id) {
      const res = await db.update(workLocations).set(values).where(and(eq(workLocations.id, id), eq(workLocations.companyId, ctx.company.id))).returning({ id: workLocations.id });
      if (!res.length) throw new HttpError(404, "Local não encontrado.");
    } else {
      const [row] = await db.insert(workLocations).values({ ...values, companyId: ctx.company.id }).returning({ id: workLocations.id });
      id = row.id;
    }
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: o.id ? "location.updated" : "location.created", entity: "work_location", entityId: id, after: { ...o } });
    revalidatePath("/empresa/locais");
    return { ok: true, message: "Local guardado." };
  });
}

export async function saveStationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("locations.manage");
    const o = z
      .object({ locationId: z.string().uuid(), name: z.string().trim().min(3), qrMode: z.enum(["dynamic", "static"]), rotationSeconds: z.coerce.number().int().min(10).max(300).default(30) })
      .parse(formObject(fd));
    const [loc] = await db.select({ id: workLocations.id }).from(workLocations).where(and(eq(workLocations.id, o.locationId), eq(workLocations.companyId, ctx.company.id))).limit(1);
    if (!loc) throw new HttpError(404, "Local não encontrado.");
    const [row] = await db.insert(attendanceStations).values({ ...o, companyId: ctx.company.id }).returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "station.created", entity: "attendance_station", entityId: row.id, after: o });
    revalidatePath("/empresa/locais");
    return { ok: true, message: o.qrMode === "static" ? "Estação criada. Gere o QR fixo para imprimir." : "Estação criada." };
  });
}

export async function toggleStationAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("locations.manage");
    await db.update(attendanceStations).set({ active }).where(and(eq(attendanceStations.id, id), eq(attendanceStations.companyId, ctx.company.id)));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: active ? "station.enabled" : "station.disabled", entity: "attendance_station", entityId: id });
    revalidatePath("/empresa/locais");
    return { ok: true, message: active ? "Estação activada." : "Estação desactivada." };
  });
}

/** Gera (ou substitui) o QR fixo. O anterior deixa de ser aceite. */
export async function generateStaticQrAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("locations.manage");
    const [st] = await db.select().from(attendanceStations).where(and(eq(attendanceStations.id, id), eq(attendanceStations.companyId, ctx.company.id))).limit(1);
    if (!st) throw new HttpError(404, "Estação não encontrada.");
    if (st.qrMode !== "static") throw new HttpError(409, "Esta estação usa QR dinâmico.");
    const token = await signQrToken({ sid: st.id, cid: ctx.company.id, mode: "static" });
    await db.update(attendanceStations).set({ staticTokenHash: sha256(token) }).where(eq(attendanceStations.id, st.id));
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const svg = await QRCode.toString(`${origin}/app/marcar?t=${encodeURIComponent(token)}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "station.static_qr_rotated", entity: "attendance_station", entityId: st.id });
    revalidatePath("/empresa/locais");
    return { ok: true, message: "Novo QR fixo gerado. O anterior foi revogado.", data: { svg, name: st.name } };
  });
}
