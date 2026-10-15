import { and, desc, eq } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceEvents, attendanceStations, attendanceValidations, employees } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { EVENT_TYPE_LABEL, GEOFENCE_LABEL } from "@/lib/labels";
import { teamFilter } from "@/lib/queries/scope";
import { ReviewEvent } from "../forms";

export const metadata: Metadata = { title: "Marcações em revisão" };

export default async function ReviewPage() {
  const ctx = await requireCompany("attendance.view");
  const tz = ctx.company.timezone;
  const rows = await db
    .select({ ev: attendanceEvents, v: attendanceValidations, name: employees.fullName, station: attendanceStations.name })
    .from(attendanceEvents)
    .innerJoin(employees, eq(employees.id, attendanceEvents.employeeId))
    .leftJoin(attendanceValidations, eq(attendanceValidations.eventId, attendanceEvents.id))
    .leftJoin(attendanceStations, eq(attendanceStations.id, attendanceEvents.stationId))
    .where(and(eq(attendanceEvents.companyId, ctx.company.id), eq(attendanceEvents.status, "review"), teamFilter(ctx)))
    .orderBy(desc(attendanceEvents.occurredAt))
    .limit(200);
  const canReview = can(ctx, "attendance.manage", "absence.decide.team");

  return (
    <>
      <PageHeader title="Marcações em revisão" description="GPS inconclusivo, sem localização, dispositivo desconhecido ou revisão pedida pelo colaborador." />
      <PageBody>
        <Notice tone="info">
          Uma marcação em revisão conta provisoriamente na assiduidade. Valide-a ou rejeite-a com fundamento; a decisão fica no trilho de auditoria.
        </Notice>
        {rows.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="Nada por rever" description="Todas as marcações foram validadas." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Colaborador</TH>
                  <TH>Marcação</TH>
                  <TH>Estação</TH>
                  <TH>Localização</TH>
                  <TH>Motivo</TH>
                  {canReview ? <TH /> : null}
                </tr>
              </THead>
              <tbody>
                {rows.map(({ ev, v, name, station }) => (
                  <TR key={ev.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={name} size={30} />
                        <span className="font-medium">{name}</span>
                      </div>
                    </TD>
                    <TD>
                      <span className="block">{EVENT_TYPE_LABEL[ev.type]}</span>
                      <span className="block text-xs text-muted tabular">{formatDateTime(ev.occurredAt, tz)}</span>
                    </TD>
                    <TD className="text-muted">{station ?? "—"}</TD>
                    <TD>
                      {v ? (
                        <>
                          <Badge tone={v.geofenceResult === "inside" ? "success" : v.geofenceResult === "outside" ? "danger" : "warning"}>{GEOFENCE_LABEL[v.geofenceResult]}</Badge>
                          <span className="mt-1 block text-xs text-muted tabular">
                            {v.accuracyM ? `±${Math.round(v.accuracyM)} m` : "sem precisão"}
                            {v.distanceM ? ` · ${Math.round(v.distanceM)} m do centro` : ""}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="max-w-xs text-xs text-muted">{ev.reason ?? "—"}</TD>
                    {canReview ? (
                      <TD className="text-right">
                        <ReviewEvent eventId={ev.id} name={name} />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </PageBody>
    </>
  );
}
