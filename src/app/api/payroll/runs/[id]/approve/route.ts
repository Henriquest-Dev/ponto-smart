import { NextResponse } from "next/server";
import { withCompany } from "@/lib/api";
import { approveRun } from "@/lib/domain/payroll/service";

export const dynamic = "force-dynamic";

/** POST /api/payroll/runs/:id/approve — aprovação humana (separação de funções). */
export const POST = withCompany<{ id: string }>(["payroll.approve"], async ({ ctx, params }) => {
  await approveRun({ companyId: ctx.company.id, userId: ctx.user.id, currency: ctx.company.currency, dailyDivisor: ctx.company.settings.payrollDailyDivisor }, params.id);
  return NextResponse.json({ ok: true });
});
