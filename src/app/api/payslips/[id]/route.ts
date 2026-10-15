import { and, eq } from "drizzle-orm";
import { withCompany, HttpError } from "@/lib/api";
import { can } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { payslips } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { renderPayslip } from "@/lib/domain/payroll/service";
import { getPrivateFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** GET /api/payslips/:id — recibo autorizado (o próprio colaborador ou RH/Financeiro). */
export const GET = withCompany<{ id: string }>([], async ({ ctx, params }) => {
  const [slip] = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.id, params.id), eq(payslips.companyId, ctx.company.id)))
    .limit(1);
  if (!slip) throw new HttpError(404, "Recibo não encontrado.");
  const own = ctx.employee?.id === slip.employeeId && can(ctx, "self.payslips");
  if (!own && !can(ctx, "payroll.view")) throw new HttpError(403, "Sem permissão para este recibo.");

  let bytes: ArrayBuffer | Uint8Array | null = slip.documentKey ? await getPrivateFile(slip.documentKey).catch(() => null) : null;
  let reference = slip.reference;
  if (!bytes) {
    const rendered = await renderPayslip(ctx.company.id, slip.id);
    if (!rendered) throw new HttpError(404, "Recibo não encontrado.");
    bytes = rendered.bytes;
    reference = rendered.data.payslip.reference;
  }
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "payslip.downloaded", entity: "payslip", entityId: slip.id });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
