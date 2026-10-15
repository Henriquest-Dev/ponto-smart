import { and, asc, eq, inArray } from "drizzle-orm";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { employees, payrollItems, payrollLines, payrollPeriods, payrollRuns } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { periodLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

/** GET /api/reports/payroll/:runId — mapa salarial de uma execução. */
export const GET = withCompany<{ runId: string }>(["payroll.view"], async ({ ctx, params }) => {
  const [run] = await db
    .select({ r: payrollRuns, p: payrollPeriods })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(and(eq(payrollRuns.id, params.runId), eq(payrollRuns.companyId, ctx.company.id)))
    .limit(1);
  if (!run) throw new HttpError(404, "Execução não encontrada.");
  const items = await db
    .select({ i: payrollItems, name: employees.fullName, code: employees.employeeCode, nuit: employees.nuit, bank: employees.bankAccount })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(eq(payrollItems.runId, run.r.id))
    .orderBy(asc(employees.employeeCode));
  const lines = items.length ? await db.select().from(payrollLines).where(inArray(payrollLines.payrollItemId, items.map((i) => i.i.id))).orderBy(asc(payrollLines.sort)) : [];
  const label = periodLabel(run.p.year, run.p.month);
  const money = "#,##0.00";
  const buf = await buildWorkbook([
    {
      name: "Mapa salarial",
      title: `${ctx.company.name} — ${label} — v${run.r.version} (${run.r.status === "approved" ? "aprovado" : "rascunho"})`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 }, { header: "NUIT", key: "nuit", width: 14 },
        { header: "Ilíquido", key: "gross", numFmt: money }, { header: "Descontos", key: "deductions", numFmt: money }, { header: "Líquido", key: "net", numFmt: money },
      ],
      rows: items.map((x) => ({ code: x.code, name: x.name, nuit: x.nuit, gross: Number(x.i.gross), deductions: Number(x.i.deductions), net: Number(x.i.net) })),
    },
    {
      name: "Linhas",
      title: `Linhas salariais — ${label}`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 }, { header: "Rubrica", key: "line", width: 14 },
        { header: "Descrição", key: "description", width: 36 }, { header: "Natureza", key: "nature", width: 11 }, { header: "Quantidade", key: "quantity" },
        { header: "Taxa", key: "rate" }, { header: "Valor", key: "amount", numFmt: money }, { header: "Origem", key: "origin", width: 12 },
      ],
      rows: lines.map((l) => {
        const it = items.find((x) => x.i.id === l.payrollItemId)!;
        return { code: it.code, name: it.name, line: l.code, description: l.description, nature: l.nature === "earning" ? "Abono" : "Desconto", quantity: l.quantity, rate: l.rate, amount: Number(l.amount), origin: l.origin };
      }),
    },
  ]);
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "report.exported", entity: "payroll_run", entityId: run.r.id });
  return xlsxResponse(buf, `salarios-${run.p.year}-${String(run.p.month).padStart(2, "0")}-v${run.r.version}.xlsx`);
});
