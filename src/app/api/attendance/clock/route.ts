import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany, HttpError } from "@/lib/api";
import { clock } from "@/lib/domain/attendance";
import { audit } from "@/lib/domain/audit";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({
  token: z.string().min(10).max(2000),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracy: z.number().min(0).max(100000).nullable(),
  deviceKey: z.string().max(200).nullable(),
  idempotencyKey: z.string().min(8).max(100),
  requested: z.enum(["break_start", "break_end"]).nullable().optional(),
  requestReview: z.boolean().optional(),
  reviewNote: z.string().max(300).nullable().optional(),
});

/** POST /api/attendance/clock — registar ponto (fluxo P01–P08). */
export const POST = withCompany(["self.clock"], async ({ req, ctx }) => {
  if (!ctx.employee) throw new HttpError(403, "Conta sem ficha de colaborador activa.", "no_employee");
  await rateLimit(`clock:${ctx.user.id}`, 12, 60);
  const input = body.parse(await req.json());
  if ((input.latitude === null) !== (input.longitude === null)) throw new HttpError(422, "Coordenadas incompletas.");
  try {
    const result = await clock(
      {
        companyId: ctx.company.id,
        timeZone: ctx.company.timezone,
        settings: ctx.company.settings,
        employeeId: ctx.employee.id,
        userId: ctx.user.id,
      },
      { ...input, requested: input.requested ?? null },
    );
    if (!result.duplicate) {
      await audit({
        companyId: ctx.company.id, actorId: ctx.user.id, action: `attendance.clock_${result.status}`, entity: "attendance_event", entityId: result.eventId,
        after: { type: result.type, geofence: result.geofence, device: result.device },
      });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof HttpError) {
      await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "attendance.clock_refused", entity: "attendance_event", after: { code: err.code } });
    }
    throw err;
  }
});
