import { and, eq } from "drizzle-orm";
import { withCompany, HttpError } from "@/lib/api";
import { can } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { absenceDocuments, absenceRequests, employees } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { getPrivateFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** GET /api/absence-documents/:id — anexo privado de uma justificação. */
export const GET = withCompany<{ id: string }>([], async ({ ctx, params }) => {
  const [doc] = await db
    .select({ doc: absenceDocuments, employeeId: absenceRequests.employeeId, departmentId: employees.departmentId })
    .from(absenceDocuments)
    .innerJoin(absenceRequests, eq(absenceRequests.id, absenceDocuments.requestId))
    .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
    .where(and(eq(absenceDocuments.id, params.id), eq(absenceDocuments.companyId, ctx.company.id)))
    .limit(1);
  if (!doc) throw new HttpError(404, "Documento não encontrado.");
  const own = ctx.employee?.id === doc.employeeId;
  const hr = can(ctx, "absence.decide");
  const team = can(ctx, "absence.decide.team") && !!doc.departmentId && (ctx.teamDepartmentIds ?? []).includes(doc.departmentId);
  if (!own && !hr && !team) throw new HttpError(403, "Sem permissão para este documento.");
  const data = await getPrivateFile(doc.doc.storageKey);
  if (!data) throw new HttpError(404, "Ficheiro indisponível.");
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "absence.document_viewed", entity: "absence_document", entityId: doc.doc.id });
  return new Response(data, {
    headers: {
      "Content-Type": doc.doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.doc.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
