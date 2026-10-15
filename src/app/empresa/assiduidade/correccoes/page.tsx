"use client";

import { AttendanceNav } from "@/components/company/p1-attendance-nav";
import { LoadingRows } from "@/components/company/p1-shared";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { DailyStatus } from "@/lib/domain/attendance-rules";
import { formatDate, formatDateTime } from "@/lib/format";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

type Row = {
  id: string;
  work_date: string;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  created_at: string;
  employees: { full_name: string } | null;
  users: { name: string } | null;
};

function describe(v: Record<string, unknown> | null) {
  if (!v) return "—";
  const parts: string[] = [];
  if (typeof v.status === "string") parts.push(DAILY_STATUS_LABEL[v.status as DailyStatus] ?? v.status);
  if (typeof v.workedMinutes === "number") parts.push(`${Math.floor(v.workedMinutes / 60)}h${String(v.workedMinutes % 60).padStart(2, "0")}`);
  return parts.join(", ") || "—";
}

export default function AdjustmentsPage() {
  const { companyId, tz } = useCompany();
  const list = useData(async () => {
    const res = await sb()
      .from("attendance_adjustments")
      .select("id,work_date,reason,previous,next,created_at,employees(full_name),users(name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    return must(res) as unknown as Row[];
  }, [companyId]);
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader title="Correcções" description="Histórico completo de alterações à assiduidade: autor, data, motivo e versão anterior." />
      <PageBody>
        <AttendanceNav active="correccoes" />
        {list.error ? (
          <Notice tone="danger">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sem correcções registadas" />
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background md:hidden">
              {rows.map((a) => (
                <li key={a.id} className="space-y-2 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[14px] font-bold">{a.employees?.full_name ?? "—"}</p>
                    <span className="text-[12.5px] font-bold text-muted tabular">{formatDate(a.work_date, tz)}</span>
                  </div>
                  <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                    <dt className="text-muted">Antes</dt>
                    <dd className="text-muted line-through decoration-1">{describe(a.previous)}</dd>
                    <dt className="text-muted">Depois</dt>
                    <dd className="inline-flex items-center gap-1.5 font-bold">
                      <span className="stem text-primary" aria-hidden />
                      {describe(a.next)}
                    </dd>
                  </dl>
                  <p className="text-[13px]">{a.reason}</p>
                  <p className="text-[12px] text-subtle">
                    {a.users?.name ?? "Autor desconhecido"}, {formatDateTime(a.created_at, tz)}
                  </p>
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Quando</TH>
                    <TH>Colaborador</TH>
                    <TH>Dia</TH>
                    <TH>Antes</TH>
                    <TH>Depois</TH>
                    <TH>Autor</TH>
                    <TH>Motivo</TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((a) => (
                    <TR key={a.id}>
                      <TD className="text-muted tabular">{formatDateTime(a.created_at, tz)}</TD>
                      <TD className="text-[14px] font-bold">{a.employees?.full_name ?? "—"}</TD>
                      <TD className="tabular">{formatDate(a.work_date, tz)}</TD>
                      <TD className="text-muted">{describe(a.previous)}</TD>
                      <TD>
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <span className="stem text-primary" aria-hidden />
                          {describe(a.next)}
                        </span>
                      </TD>
                      <TD className="text-muted">{a.users?.name ?? "—"}</TD>
                      <TD className="max-w-xs text-[12.5px] leading-snug text-muted">{a.reason}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </>
        )}
      </PageBody>
    </>
  );
}
