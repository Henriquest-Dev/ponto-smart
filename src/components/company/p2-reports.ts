"use client";

import { buildWorkbook, downloadBlob } from "@/lib/excel";
import { formatTime, periodLabel } from "@/lib/format";
import { DAILY_STATUS_LABEL } from "@/lib/labels";
import type { DailyStatus } from "@/lib/domain/attendance-rules";
import { must, rpc, sb } from "@/lib/sb/client";
import { loadItems, loadLines, RUN_COLUMNS, type Run } from "./p2-payroll";
import { chunks, fetchAll, monthBounds } from "./p2-shared";

const MONEY = "#,##0.00";

type DailyRow = {
  work_date: string;
  status: DailyStatus;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  employees: { full_name: string; employee_code: string; departments: { name: string } | null } | null;
};

/** Assiduidade do mês: resumo por colaborador e detalhe diário. */
export async function exportAttendance(companyId: string, companyName: string, ym: string, tz: string) {
  const { year, month, from, to } = monthBounds(ym);
  const rows = (await fetchAll(() =>
    sb()
      .from("attendance_daily")
      .select("work_date,status,first_in,last_out,worked_minutes,late_minutes,overtime_minutes,employees(full_name,employee_code,departments(name))")
      .eq("company_id", companyId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("id"),
  )) as unknown as DailyRow[];
  rows.sort((a, b) => (a.employees?.employee_code ?? "").localeCompare(b.employees?.employee_code ?? "") || a.work_date.localeCompare(b.work_date));

  type Sum = { code: string; name: string; department: string; worked: number; hours: number; overtime: number; late: number; lateMin: number; unjustified: number; justified: number; pending: number };
  const summary = new Map<string, Sum>();
  for (const r of rows) {
    const code = r.employees?.employee_code ?? "—";
    const s = summary.get(code) ?? { code, name: r.employees?.full_name ?? "—", department: r.employees?.departments?.name ?? "", worked: 0, hours: 0, overtime: 0, late: 0, lateMin: 0, unjustified: 0, justified: 0, pending: 0 };
    if (r.first_in) s.worked += 1;
    s.hours += r.worked_minutes / 60;
    s.overtime += r.overtime_minutes / 60;
    if (r.status === "late") {
      s.late += 1;
      s.lateMin += r.late_minutes;
    }
    if (r.status === "unjustified") s.unjustified += 1;
    if (r.status === "justified") s.justified += 1;
    if (r.status === "absent_pending" || r.status === "incomplete" || r.status === "review") s.pending += 1;
    summary.set(code, s);
  }

  const blob = await buildWorkbook([
    {
      name: "Resumo",
      title: `${companyName} — Assiduidade ${periodLabel(year, month)}`,
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
      title: `Registos diários — ${periodLabel(year, month)}`,
      columns: [
        { header: "Data", key: "date", width: 12 }, { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 },
        { header: "Entrada", key: "in", width: 10 }, { header: "Saída", key: "out", width: 10 }, { header: "Horas", key: "hours", numFmt: "0.00" },
        { header: "Atraso (min)", key: "late" }, { header: "Extra (min)", key: "overtime" }, { header: "Estado", key: "status", width: 20 },
      ],
      rows: rows.map((r) => ({
        date: r.work_date,
        code: r.employees?.employee_code,
        name: r.employees?.full_name,
        in: r.first_in ? formatTime(r.first_in, tz) : "",
        out: r.last_out ? formatTime(r.last_out, tz) : "",
        hours: r.worked_minutes / 60,
        late: r.late_minutes,
        overtime: r.overtime_minutes,
        status: DAILY_STATUS_LABEL[r.status] ?? r.status,
      })),
    },
  ]);
  downloadBlob(blob, `assiduidade-${ym}.xlsx`);
  void rpc("ps_log_export", { p_company: companyId, p_report: "assiduidade", p_details: { month: ym } }).catch(() => {});
  return rows.length;
}

type EmpRow = {
  id: string;
  employee_code: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  hire_date: string | null;
  status: string;
  departments: { name: string } | null;
  branches: { name: string } | null;
};

const EMP_STATUS: Record<string, string> = { active: "Activo", inactive: "Inactivo", terminated: "Cessado" };

/** Lista de colaboradores; o salário base vigente só é incluído com permissão para o ver. */
export async function exportEmployees(companyId: string, companyName: string, withSalary: boolean, today: string) {
  const rows = (await fetchAll(() =>
    sb()
      .from("employees")
      .select("id,employee_code,full_name,job_title,email,phone,hire_date,status,departments(name),branches(name)")
      .eq("company_id", companyId)
      .order("employee_code"),
  )) as unknown as EmpRow[];

  const salary = new Map<string, number>();
  if (withSalary && rows.length) {
    for (const ids of chunks(rows.map((r) => r.id))) {
      const agreements = must(
        await sb()
          .from("salary_agreements")
          .select("employee_id,amount,effective_from,effective_to")
          .in("employee_id", ids)
          .lte("effective_from", today)
          .order("effective_from", { ascending: false }),
      ) as { employee_id: string; amount: string; effective_from: string; effective_to: string | null }[];
      for (const a of agreements) {
        if (salary.has(a.employee_id)) continue;
        if (a.effective_to && a.effective_to < today) continue;
        salary.set(a.employee_id, Number(a.amount));
      }
    }
  }

  const columns = [
    { header: "Nº", key: "code", width: 12 }, { header: "Nome", key: "name", width: 28 }, { header: "Função", key: "job", width: 24 },
    { header: "Departamento", key: "department", width: 18 }, { header: "Filial", key: "branch", width: 18 }, { header: "Email", key: "email", width: 28 },
    { header: "Telefone", key: "phone", width: 16 }, { header: "Admissão", key: "hire", width: 12 }, { header: "Estado", key: "status", width: 12 },
  ];
  if (withSalary) columns.push({ header: "Salário base", key: "salary", width: 16, numFmt: MONEY } as (typeof columns)[number]);

  const blob = await buildWorkbook([
    {
      name: "Colaboradores",
      title: `${companyName} — Colaboradores`,
      columns,
      rows: rows.map((r) => ({
        code: r.employee_code,
        name: r.full_name,
        job: r.job_title,
        department: r.departments?.name,
        branch: r.branches?.name,
        email: r.email,
        phone: r.phone,
        hire: r.hire_date,
        status: EMP_STATUS[r.status] ?? r.status,
        salary: salary.get(r.id) ?? null,
      })),
    },
  ]);
  downloadBlob(blob, "colaboradores.xlsx");
  void rpc("ps_log_export", { p_company: companyId, p_report: "colaboradores", p_details: { withSalary } }).catch(() => {});
  return rows.length;
}

const ORIGIN: Record<string, string> = { contract: "Contrato", attendance: "Assiduidade", component: "Rubrica", rule: "Regra legal" };

/** Mapa salarial de uma execução (totais por colaborador e linhas). */
export async function exportPayrollRun(runId: string, companyName: string) {
  const run = must(await sb().from("payroll_runs").select(`${RUN_COLUMNS},payroll_periods(year,month)`).eq("id", runId).single()) as unknown as Run & {
    payroll_periods: { year: number; month: number } | null;
  };
  const year = run.payroll_periods?.year ?? 0;
  const month = run.payroll_periods?.month ?? 1;
  const items = await loadItems(runId);
  const lines = items.length ? await loadLines(items.map((i) => i.id)) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = periodLabel(year, month);
  const blob = await buildWorkbook([
    {
      name: "Mapa salarial",
      title: `${companyName} — ${label} — v${run.version} (${run.status === "approved" ? "aprovado" : run.status === "draft" ? "rascunho" : "substituído"})`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 }, { header: "NUIT", key: "nuit", width: 14 },
        { header: "Ilíquido", key: "gross", numFmt: MONEY }, { header: "Descontos", key: "deductions", numFmt: MONEY }, { header: "Líquido", key: "net", numFmt: MONEY },
      ],
      rows: items.map((x) => ({
        code: x.employees?.employee_code,
        name: x.employees?.full_name,
        nuit: x.employees?.nuit,
        gross: Number(x.gross),
        deductions: Number(x.deductions),
        net: Number(x.net),
      })),
    },
    {
      name: "Linhas",
      title: `Linhas salariais — ${label}`,
      columns: [
        { header: "Nº", key: "code", width: 12 }, { header: "Colaborador", key: "name", width: 28 }, { header: "Rubrica", key: "line", width: 14 },
        { header: "Descrição", key: "description", width: 36 }, { header: "Natureza", key: "nature", width: 11 }, { header: "Quantidade", key: "quantity" },
        { header: "Taxa", key: "rate" }, { header: "Valor", key: "amount", numFmt: MONEY }, { header: "Origem", key: "origin", width: 12 },
      ],
      rows: lines.map((l) => {
        const it = byId.get(l.payroll_item_id);
        return {
          code: it?.employees?.employee_code,
          name: it?.employees?.full_name,
          line: l.code,
          description: l.description,
          nature: l.nature === "earning" ? "Abono" : "Desconto",
          quantity: l.quantity == null ? null : Number(l.quantity),
          rate: l.rate == null ? null : Number(l.rate),
          amount: Number(l.amount),
          origin: ORIGIN[l.origin] ?? l.origin,
        };
      }),
    },
  ]);
  downloadBlob(blob, `salarios-${year}-${String(month).padStart(2, "0")}-v${run.version}.xlsx`);
}
