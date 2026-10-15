import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { CalendarCheck2 } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceDaily, departments, employees } from "@/lib/db/schema";
import { formatDate, formatMinutes, formatTime } from "@/lib/format";
import { dailyStatus } from "@/lib/labels";
import { teamFilter } from "@/lib/queries/scope";
import { addDays, localDate } from "@/lib/time";
import { ClassifyDay, CloseDay } from "./forms";

export const metadata: Metadata = { title: "Assiduidade" };

const FILTERS: Record<string, string[] | null> = {
  todos: null,
  pendentes: ["absent_pending", "incomplete", "review"],
  atrasos: ["late"],
  faltas: ["absent_pending", "unjustified", "justified"],
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ data?: string; ate?: string; estado?: string }> }) {
  const ctx = await requireCompany("attendance.view");
  const tz = ctx.company.timezone;
  const sp = await searchParams;
  const today = localDate(new Date(), tz);
  const estado = sp.estado && sp.estado in FILTERS ? sp.estado : "todos";
  // Pendentes: últimos 45 dias por defeito; restantes: dia escolhido.
  const from = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : estado === "pendentes" ? addDays(today, -45) : today;
  const to = sp.ate && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate) && sp.ate >= from ? sp.ate : estado === "pendentes" && !sp.data ? today : from;
  const statuses = FILTERS[estado];

  const rows = await db
    .select({ d: attendanceDaily, name: employees.fullName, code: employees.employeeCode, department: departments.name })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(attendanceDaily.companyId, ctx.company.id),
        teamFilter(ctx),
        statuses ? inArray(attendanceDaily.status, statuses as (typeof attendanceDaily.$inferSelect.status)[]) : undefined,
        gte(attendanceDaily.workDate, from),
        lte(attendanceDaily.workDate, to),
      ),
    )
    .orderBy(asc(attendanceDaily.workDate), asc(employees.fullName));
  const inRange = rows.slice(0, 500);
  const count = (s: string[]) => inRange.filter((r) => s.includes(r.d.status)).length;
  const manage = can(ctx, "attendance.manage");

  return (
    <>
      <PageHeader
        title="Assiduidade"
        description="Registos diários consolidados a partir das marcações."
        actions={manage ? <CloseDay defaultDate={addDays(today, -1)} /> : null}
      />
      <PageBody>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <label className="flex flex-col gap-1 text-xs text-muted">
              De
              <Input type="date" name="data" defaultValue={from} max={today} className="sm:w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Até
              <Input type="date" name="ate" defaultValue={to} max={today} className="sm:w-40" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Estado
            <Select name="estado" defaultValue={estado} className="sm:w-44">
              <option value="todos">Todos</option>
              <option value="pendentes">Pendências</option>
              <option value="atrasos">Atrasos</option>
              <option value="faltas">Faltas</option>
            </Select>
          </label>
          <Button type="submit" variant="soft">Aplicar</Button>
        </form>

        <StatRow>
          <Stat label="Registos" value={inRange.length} hint={from === to ? formatDate(from, tz) : `${formatDate(from, tz)} – ${formatDate(to, tz)}`} />
          <Stat label="Pontuais" value={count(["on_time", "present"])} />
          <Stat label="Atrasos" value={count(["late"])} />
          <Stat label="Pendências" value={count(["absent_pending", "incomplete", "review"])} />
        </StatRow>

        {inRange.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 />} title="Sem registos para estes filtros" description="Os dias sem marcação passam a falta pendente quando o dia é fechado." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Colaborador</TH>
                  <TH>Data</TH>
                  <TH>Entrada</TH>
                  <TH>Saída</TH>
                  <TH>Trabalhado</TH>
                  <TH>Atraso</TH>
                  <TH>Estado</TH>
                  {manage ? <TH className="text-right">Acções</TH> : null}
                </tr>
              </THead>
              <tbody>
                {inRange.map(({ d, name, department }) => {
                  const st = dailyStatus(d.status);
                  return (
                    <TR key={d.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={name} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{name}</span>
                            <span className="block truncate text-xs text-muted">{department ?? "—"}</span>
                          </span>
                        </div>
                      </TD>
                      <TD className="text-muted tabular">{formatDate(d.workDate, tz)}</TD>
                      <TD className="tabular">{formatTime(d.firstIn, tz)}</TD>
                      <TD className="tabular">{formatTime(d.lastOut, tz)}</TD>
                      <TD className="tabular">{formatMinutes(d.workedMinutes)}</TD>
                      <TD className="text-muted tabular">{d.lateMinutes ? `${d.lateMinutes} min` : "—"}</TD>
                      <TD>
                        <span className="flex items-center gap-1.5">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {d.locked ? <Badge>Fechado</Badge> : null}
                        </span>
                      </TD>
                      {manage ? (
                        <TD className="text-right">
                          {!d.locked && !["holiday", "day_off"].includes(d.status) ? (
                            <ClassifyDay dailyId={d.id} name={name} date={formatDate(d.workDate, tz)} firstIn={d.firstIn ? formatTime(d.firstIn, tz) : ""} lastOut={d.lastOut ? formatTime(d.lastOut, tz) : ""} />
                          ) : null}
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </PageBody>
    </>
  );
}
