"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requireCompany } from "@/lib/auth/context";
import { decideAbsence } from "@/lib/domain/absence";
import { employeesInDepartments } from "@/lib/domain/attendance";
import { formObject, runAction, type ActionResult } from "@/lib/action";

export async function decideAbsenceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireCompany("absence.decide", "absence.decide.team");
    const o = z
      .object({ requestId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().min(3, "Indique o fundamento da decisão.") })
      .parse(formObject(fd));
    const isHr = can(ctx, "absence.decide");
    await decideAbsence({
      companyId: ctx.company.id,
      requestId: o.requestId,
      userId: ctx.user.id,
      role: isHr ? "hr" : "supervisor",
      decision: o.decision,
      reason: o.reason,
      allowedEmployeeIds: isHr ? null : await employeesInDepartments(ctx.company.id, ctx.teamDepartmentIds ?? []),
    });
    revalidatePath("/empresa/justificacoes");
    return { ok: true, message: o.decision === "approved" ? "Decisão registada: aprovada." : "Decisão registada: recusada." };
  });
}
