import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany } from "@/lib/api";
import { can } from "@/lib/auth/context";
import { decideAbsence } from "@/lib/domain/absence";
import { employeesInDepartments } from "@/lib/domain/attendance";

export const dynamic = "force-dynamic";

/** PATCH /api/absence-requests/:id — decisão autorizada e fundamentada. */
export const PATCH = withCompany<{ id: string }>(["absence.decide", "absence.decide.team"], async ({ req, ctx, params }) => {
  const input = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().min(3) }).parse(await req.json());
  const isHr = can(ctx, "absence.decide");
  await decideAbsence({
    companyId: ctx.company.id,
    requestId: params.id,
    userId: ctx.user.id,
    role: isHr ? "hr" : "supervisor",
    decision: input.decision,
    reason: input.reason,
    allowedEmployeeIds: isHr ? null : await employeesInDepartments(ctx.company.id, ctx.teamDepartmentIds ?? []),
  });
  return NextResponse.json({ ok: true });
});
