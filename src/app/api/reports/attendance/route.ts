import { and, asc, eq, gte, lte } from "drizzle-orm";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { attendanceDaily, departments, employees } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { formatTime, periodLabel } from "@/lib/format";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import { teamFilter } from "@/lib/queries/scope";
import { monthRange } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET /api/reports/attendance?month=YYYY-MM — assiduidade mensal (detalhe + resumo). */
export const GET = withCompany(["reports.export"], async ({ req, ctx }) => {
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(422, "Indique o mês (YYYY-MM).");
  const [y, m] = month.split("-").map(Number);
  const { from, to } = monthRange(y, m);
  const tz = ctx.company.timezone;
  const rows = await db
    .select({ d: attendanceDaily, name: employees.fullName, code: employees.employeeCode, department: departments.name })
    .from(attendanceDaily)
    .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(attendanceDaily.companyId, ctx.company.id), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to), teamFilter(ctx)))
    .orderBy(asc(employees.employeeCode), asc(attendanceDaily.workDate));

  const summary = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const s = summary.get(r.code) ?? { code: r.code, name: r.name, department: r.department ?? "", worked: 0, hours: 0, overtime: 0, late: 0, lateMin: 0, unjustified: 0, justified: 0, pending: 0 };
    if (r.d.firstIn) s.worked = Number(s.worked) + 1;
    s.hours = Number(s.hours) + r.d.workedMinutes / 60;
    s.overtime = Number(s.overtime) + r.d.overtimeMinutes / 60;
    if (r.d.status === "late") { s.late = Number(s.late) + 1; s.lateMin = Number(s.lateMin) + r.d.lateMinutes; }
    if (r.d.status === "unjustified") s.unjustified = Number(s.unjustified) + 1;
    if (r.d.status === "justified") s.justified = Number(s.justified) + 1;
    if (["absent_pending", "incomplete", "review"].includes(r.d.status)) s.pending = Number(s.pending) + 1;
    summary.set(r.code, s);
  }

  const buf = await buildWorkbook([
    {
      name: "Resumo",
      title: `${ctx.company.name} — Assiduidade ${periodLabel(y, m)}`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 }, { header: "Departamento", key: "department", width: 18 },
        { header: "Dias trabalhados", key: "worked" }, { header: "Horas", key: "hours", numFmt: "0.00" }, { header: "Horas extra", key: "overtime", numFmt: "0.00" },
        { header: "Atrasos", key: "late" }, { header: "Min. atraso", key: "lateMin" }, { header: "Faltas injust.", key: "unjustified" },
        { header: "Faltas just.", key: "justified" }, { header: "Pendências", key: "pending" },
      ],
      rows: [...summary.values()],
    },
    {
      name: "Detalhe diário",
      title: `Registos diários — ${periodLabel(y, m)}`,
      columns: [
        { header: "Data", key: "date", width: 12 }, { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 },
        { header: "Entrada", key: "in", width: 10 }, { header: "Saída", key: "out", width: 10 }, { header: "Horas", key: "hours", numFmt: "0.00" },
        { header: "Atraso (min)", key: "late" }, { header: "Extra (min)", key: "overtime" }, { header: "Estado", key: "status", width: 20 },
      ],
      rows: rows.map((r) => ({
        date: r.d.workDate, code: r.code, name: r.name, in: r.d.firstIn ? formatTime(r.d.firstIn, tz) : "", out: r.d.lastOut ? formatTime(r.d.lastOut, tz) : "",
        hours: r.d.workedMinutes / 60, late: r.d.lateMinutes, overtime: r.d.overtimeMinutes, status: DAILY_STATUS_LABEL[r.d.status],
      })),
    },
  ]);
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "report.exported", entity: "attendance", after: { month } });
  return xlsxResponse(buf, `assiduidade-${month}.xlsx`);
});
