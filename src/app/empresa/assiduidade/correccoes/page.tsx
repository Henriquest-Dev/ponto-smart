import { and, desc, eq } from "drizzle-orm";
import { History } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceAdjustments, employees, users } from "@/lib/db/schema";
import { formatDate, formatDateTime } from "@/lib/format";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import { teamFilter } from "@/lib/queries/scope";

export const metadata: Metadata = { title: "Correcções" };

function describe(v: Record<string, unknown> | null) {
  if (!v) return "—";
  const parts: string[] = [];
  if (typeof v.status === "string") parts.push(DAILY_STATUS_LABEL[v.status as keyof typeof DAILY_STATUS_LABEL] ?? v.status);
  if (typeof v.workedMinutes === "number") parts.push(`${Math.floor(v.workedMinutes / 60)}h${String(v.workedMinutes % 60).padStart(2, "0")}`);
  return parts.join(" · ") || "—";
}

export default async function AdjustmentsPage() {
  const ctx = await requireCompany("attendance.view");
  const tz = ctx.company.timezone;
  const rows = await db
    .select({ a: attendanceAdjustments, name: employees.fullName, author: users.name })
    .from(attendanceAdjustments)
    .innerJoin(employees, eq(employees.id, attendanceAdjustments.employeeId))
    .innerJoin(users, eq(users.id, attendanceAdjustments.authorId))
    .where(and(eq(attendanceAdjustments.companyId, ctx.company.id), teamFilter(ctx)))
    .orderBy(desc(attendanceAdjustments.createdAt))
    .limit(200);
  return (
    <>
      <PageHeader title="Correcções" description="Histórico completo de alterações à assiduidade: autor, data, motivo e versão anterior." />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState icon={<History />} title="Sem correcções registadas" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr><TH>Quando</TH><TH>Colaborador</TH><TH>Dia</TH><TH>Antes</TH><TH>Depois</TH><TH>Autor</TH><TH>Motivo</TH></tr>
              </THead>
              <tbody>
                {rows.map(({ a, name, author }) => (
                  <TR key={a.id}>
                    <TD className="text-muted tabular">{formatDateTime(a.createdAt, tz)}</TD>
                    <TD className="font-medium">{name}</TD>
                    <TD className="tabular">{formatDate(a.workDate, tz)}</TD>
                    <TD className="text-muted">{describe(a.previous)}</TD>
                    <TD>{describe(a.next)}</TD>
                    <TD className="text-muted">{author}</TD>
                    <TD className="max-w-xs text-xs text-muted">{a.reason}</TD>
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
