import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { FileCheck2, Paperclip } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { absenceDocuments, absenceRequests, approvalSteps, departments, employees, users } from "@/lib/db/schema";
import { ABSENCE_TYPES } from "@/lib/domain/absence";
import { formatDate, formatDateTime } from "@/lib/format";
import { ABSENCE_STATUS, STEP_DECISION } from "@/lib/labels";
import { teamFilter } from "@/lib/queries/scope";
import { daysBetween } from "@/lib/time";
import { DecideAbsence } from "./decide";

export const metadata: Metadata = { title: "Justificações" };

export default async function CompanyAbsences({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const ctx = await requireCompany("absence.decide", "absence.decide.team");
  const tz = ctx.company.timezone;
  const { v } = await searchParams;
  const view = v === "decididas" ? "decididas" : "pendentes";
  const requests = await db
    .select({ r: absenceRequests, name: employees.fullName, jobTitle: employees.jobTitle, department: departments.name, userId: employees.userId })
    .from(absenceRequests)
    .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(absenceRequests.companyId, ctx.company.id),
        teamFilter(ctx),
        view === "pendentes" ? eq(absenceRequests.status, "pending") : inArray(absenceRequests.status, ["approved", "rejected", "cancelled"]),
      ),
    )
    .orderBy(view === "pendentes" ? asc(absenceRequests.createdAt) : desc(absenceRequests.decidedAt))
    .limit(100);
  const ids = requests.map((r) => r.r.id);
  const steps = ids.length
    ? await db
        .select({ s: approvalSteps, approver: users.name })
        .from(approvalSteps)
        .leftJoin(users, eq(users.id, approvalSteps.approverId))
        .where(inArray(approvalSteps.requestId, ids))
        .orderBy(asc(approvalSteps.stepOrder))
    : [];
  const docs = ids.length ? await db.select().from(absenceDocuments).where(inArray(absenceDocuments.requestId, ids)) : [];
  const isHr = can(ctx, "absence.decide");

  return (
    <>
      <PageHeader title="Justificações" description="Pedido do colaborador → análise do supervisor/RH → decisão fundamentada → recálculo da assiduidade." />
      <PageBody>
        <LinkTabs
          active={view}
          items={[
            { key: "pendentes", label: "Por decidir", href: "?v=pendentes", count: view === "pendentes" ? requests.length : undefined },
            { key: "decididas", label: "Decididas", href: "?v=decididas" },
          ]}
        />
        {requests.length === 0 ? (
          <EmptyState icon={<FileCheck2 />} title={view === "pendentes" ? "Sem justificações por decidir" : "Sem decisões registadas"} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {requests.map(({ r, name, jobTitle, department, userId }) => {
              const rs = steps.filter((s) => s.s.requestId === r.id);
              const current = rs.find((s) => s.s.decision === "pending");
              const canDecide =
                r.status === "pending" && userId !== ctx.user.id && (isHr || current?.s.approverRole === "supervisor");
              const st = ABSENCE_STATUS[r.status];
              const nDays = daysBetween(r.startDate, r.endDate).length;
              return (
                <Card key={r.id} className="flex flex-col p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{name}</p>
                      <p className="truncate text-xs text-muted">{jobTitle ?? "—"} · {department ?? "Sem departamento"}</p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface/70 px-4 py-3 text-[13px]">
                    <div>
                      <p className="text-xs text-muted">Tipo</p>
                      <p className="font-medium">{ABSENCE_TYPES[r.type] ?? r.type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Período</p>
                      <p className="font-medium tabular">
                        {r.startDate === r.endDate ? formatDate(r.startDate, tz) : `${formatDate(r.startDate, tz)} – ${formatDate(r.endDate, tz)}`}
                        <span className="text-muted"> ({nDays} {nDays === 1 ? "dia" : "dias"})</span>
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed">{r.reason}</p>
                  {docs.some((d) => d.requestId === r.id) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {docs.filter((d) => d.requestId === r.id).map((d) => (
                        <a key={d.id} href={`/api/absence-documents/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface">
                          <Paperclip className="size-3.5" /> {d.fileName}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-subtle">Sem anexos.</p>
                  )}
                  <ol className="mt-4 space-y-1.5 border-t border-border pt-3">
                    {rs.map(({ s, approver }) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="w-28 text-muted">{s.approverRole === "supervisor" ? "Supervisor" : "Recursos Humanos"}</span>
                        <Badge tone={STEP_DECISION[s.decision].tone}>{STEP_DECISION[s.decision].label}</Badge>
                        {approver ? <span className="text-muted">por {approver}</span> : null}
                        {s.reason && s.decision !== "pending" ? <span className="w-full pl-30 text-muted sm:w-auto sm:pl-0">“{s.reason}”</span> : null}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-xs text-subtle">Submetido {formatDateTime(r.createdAt, tz)}</span>
                    {canDecide ? <DecideAbsence requestId={r.id} name={name} /> : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
