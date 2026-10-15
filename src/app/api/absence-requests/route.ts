import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany, HttpError } from "@/lib/api";
import { createAbsenceRequest } from "@/lib/domain/absence";

export const dynamic = "force-dynamic";

/** POST /api/absence-requests — justificação (multipart: startDate, endDate, type, reason, files[]). */
export const POST = withCompany(["self.absence"], async ({ req, ctx }) => {
  if (!ctx.employee) throw new HttpError(403, "Conta sem ficha de colaborador.");
  const fd = await req.formData();
  const input = z
    .object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.string(), reason: z.string().min(5).max(1000) })
    .parse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const request = await createAbsenceRequest({ companyId: ctx.company.id, settings: ctx.company.settings, employeeId: ctx.employee.id, userId: ctx.user.id, ...input, files });
  return NextResponse.json({ ok: true, request: { id: request.id, status: request.status } }, { status: 201 });
});
