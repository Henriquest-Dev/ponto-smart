import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany } from "@/lib/api";
import { getOrCreatePeriod, prepareRun } from "@/lib/domain/payroll/service";

export const dynamic = "force-dynamic";

/** POST /api/payroll/runs — pré-processamento {year, month}. Requer assiduidade fechada. */
export const POST = withCompany(["payroll.prepare"], async ({ req, ctx }) => {
  const { year, month } = z.object({ year: z.number().int().min(2000), month: z.number().int().min(1).max(12) }).parse(await req.json());
  const period = await getOrCreatePeriod(ctx.company.id, year, month);
  const run = await prepareRun({ companyId: ctx.company.id, userId: ctx.user.id, currency: ctx.company.currency, dailyDivisor: ctx.company.settings.payrollDailyDivisor }, period.id);
  return NextResponse.json({ ok: true, run: { id: run.id, version: run.version, totals: run.totals, warnings: run.warnings } }, { status: 201 });
});
