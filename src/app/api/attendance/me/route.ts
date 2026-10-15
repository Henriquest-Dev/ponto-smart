import { NextResponse } from "next/server";
import { withCompany, HttpError } from "@/lib/api";
import { monthDays, monthEvents, summarize } from "@/lib/queries/employee";
import { localDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET /api/attendance/me?month=YYYY-MM — histórico próprio. */
export const GET = withCompany(["self.history"], async ({ req, ctx }) => {
  if (!ctx.employee) throw new HttpError(403, "Conta sem ficha de colaborador.");
  const param = new URL(req.url).searchParams.get("month") ?? localDate(new Date(), ctx.company.timezone).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(param)) throw new HttpError(422, "Formato de mês inválido (YYYY-MM).");
  const [y, m] = param.split("-").map(Number);
  const [days, events] = await Promise.all([
    monthDays(ctx.company.id, ctx.employee.id, y, m),
    monthEvents(ctx.company.id, ctx.employee.id, y, m),
  ]);
  return NextResponse.json({ ok: true, month: param, summary: summarize(days), days, events });
});
