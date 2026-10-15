"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { absenceRequests, approvalSteps, payslipAcknowledgements, payslips, trustedDevices } from "@/lib/db/schema";
import { requireEmployee } from "@/lib/auth/context";
import { requestMeta } from "@/lib/request";
import { sha256 } from "@/lib/crypto";
import { createAbsenceRequest } from "@/lib/domain/absence";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";
import { HttpError } from "@/lib/errors";

const absenceSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data inicial."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data final."),
  type: z.string().min(1, "Escolha o tipo."),
  reason: z.string().min(5, "Descreva o motivo (mín. 5 caracteres).").max(1000),
});

export async function createAbsenceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireEmployee();
    const input = absenceSchema.parse(formObject(fd));
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    await createAbsenceRequest({
      companyId: ctx.company.id,
      settings: ctx.company.settings,
      employeeId: ctx.employee.id,
      userId: ctx.user.id,
      ...input,
      files,
    });
    revalidatePath("/app/justificacoes");
    return { ok: true, message: "Justificação submetida. Será notificado da decisão." };
  });
}

export async function cancelAbsenceAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireEmployee();
    const [req] = await db
      .select()
      .from(absenceRequests)
      .where(and(eq(absenceRequests.id, id), eq(absenceRequests.companyId, ctx.company.id), eq(absenceRequests.employeeId, ctx.employee.id)))
      .limit(1);
    if (!req) throw new HttpError(404, "Pedido não encontrado.");
    if (req.status !== "pending") throw new HttpError(409, "Só pode cancelar pedidos em análise.");
    await db.update(absenceRequests).set({ status: "cancelled", decidedAt: new Date() }).where(eq(absenceRequests.id, id));
    await db.update(approvalSteps).set({ decision: "skipped" }).where(and(eq(approvalSteps.requestId, id), eq(approvalSteps.decision, "pending")));
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "absence.cancelled", entity: "absence_request", entityId: id });
    revalidatePath("/app/justificacoes");
    return { ok: true, message: "Pedido cancelado." };
  });
}

export async function acknowledgePayslipAction(payslipId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireEmployee();
    const [slip] = await db
      .select()
      .from(payslips)
      .where(and(eq(payslips.id, payslipId), eq(payslips.companyId, ctx.company.id), eq(payslips.employeeId, ctx.employee.id)))
      .limit(1);
    if (!slip) throw new HttpError(404, "Recibo não encontrado.");
    const { ip } = await requestMeta();
    await db.insert(payslipAcknowledgements).values({ companyId: ctx.company.id, payslipId, employeeId: ctx.employee.id, ip }).onConflictDoNothing();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payslip.acknowledged", entity: "payslip", entityId: payslipId });
    revalidatePath("/app/recibos");
    return { ok: true, message: "Recepção confirmada." };
  });
}

export async function registerDeviceAction(deviceKey: string, label: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireEmployee();
    if (!deviceKey || deviceKey.length < 32) throw new HttpError(422, "Identificador de dispositivo inválido.");
    const { userAgent } = await requestMeta();
    const active = await db
      .select({ id: trustedDevices.id })
      .from(trustedDevices)
      .where(and(eq(trustedDevices.employeeId, ctx.employee.id), isNull(trustedDevices.revokedAt)));
    if (active.length >= 3) throw new HttpError(409, "Limite de 3 dispositivos activos. Revogue um antes de adicionar outro.");
    const [d] = await db
      .insert(trustedDevices)
      .values({ companyId: ctx.company.id, employeeId: ctx.employee.id, credentialId: sha256(deviceKey), label: label.slice(0, 60) || "Dispositivo", userAgent })
      .onConflictDoUpdate({ target: [trustedDevices.employeeId, trustedDevices.credentialId], set: { revokedAt: null, label: label.slice(0, 60) || "Dispositivo" } })
      .returning();
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "device.registered", entity: "trusted_device", entityId: d.id });
    revalidatePath("/app/perfil");
    return { ok: true, message: "Dispositivo registado como de confiança." };
  });
}

export async function revokeDeviceAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireEmployee();
    const res = await db
      .update(trustedDevices)
      .set({ revokedAt: new Date() })
      .where(and(eq(trustedDevices.id, id), eq(trustedDevices.employeeId, ctx.employee.id)))
      .returning({ id: trustedDevices.id });
    if (!res.length) throw new HttpError(404, "Dispositivo não encontrado.");
    await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "device.revoked", entity: "trusted_device", entityId: id });
    revalidatePath("/app/perfil");
    return { ok: true, message: "Dispositivo revogado." };
  });
}
