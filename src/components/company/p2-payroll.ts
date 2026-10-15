"use client";

import { hashInput, runPayroll, type EngineInput } from "@/lib/domain/payroll/engine";
import { renderPayslipPdf } from "@/lib/domain/payroll/payslip-pdf";
import { must, rpc, sb } from "@/lib/sb/client";
import { chunks, fetchAll } from "./p2-shared";

export type Period = { id: string; year: number; month: number; status: "open" | "attendance_closed" | "approved" | "closed"; attendance_closed_at: string | null; closed_at: string | null };

export type Run = {
  id: string;
  period_id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  engine_version: string;
  input_hash: string;
  prepared_by: string;
  prepared_at: string;
  approved_by: string | null;
  approved_at: string | null;
  totals: { gross: string; deductions: string; net: string; employees: number };
  warnings: { employeeId?: string; code: string; message: string }[];
  preparer: { name: string } | null;
  approver: { name: string } | null;
};

export type Item = {
  id: string;
  employee_id: string;
  gross: string;
  deductions: string;
  net: string;
  currency: string;
  employees: { full_name: string; employee_code: string; job_title: string | null; nuit: string | null; departments: { name: string } | null } | null;
};

export type Line = {
  id: string;
  payroll_item_id: string;
  code: string;
  description: string;
  nature: "earning" | "deduction";
  quantity: string | null;
  rate: string | null;
  amount: string;
  origin: string;
  sort: number;
};

export type Slip = { id: string; payroll_item_id: string; reference: string; issued_at: string };
export type Payment = { id: string; payroll_item_id: string; amount: string; paid_at: string; method: string; reference: string | null };

export const RUN_COLUMNS =
  "id,period_id,version,status,engine_version,input_hash,prepared_by,prepared_at,approved_by,approved_at,totals,warnings," +
  "preparer:users!payroll_runs_prepared_by_users_id_fk(name),approver:users!payroll_runs_approved_by_users_id_fk(name)";

export const ITEM_COLUMNS = "id,employee_id,gross,deductions,net,currency,employees(full_name,employee_code,job_title,nuit,departments(name))";

export async function loadPeriods(companyId: string) {
  return must(
    await sb()
      .from("payroll_periods")
      .select("id,year,month,status,attendance_closed_at,closed_at")
      .eq("company_id", companyId)
      .order("year", { ascending: false })
      .order("month", { ascending: false }),
  ) as Period[];
}

export async function loadRuns(periodId: string) {
  return must(await sb().from("payroll_runs").select(RUN_COLUMNS).eq("period_id", periodId).order("version", { ascending: false })) as unknown as Run[];
}

export async function loadItems(runId: string) {
  const rows = (await fetchAll(() => sb().from("payroll_items").select(ITEM_COLUMNS).eq("run_id", runId).order("id"))) as unknown as Item[];
  return rows.sort((a, b) => (a.employees?.employee_code ?? "").localeCompare(b.employees?.employee_code ?? ""));
}

export async function loadLines(itemIds: string[]) {
  const out: Line[] = [];
  for (const ids of chunks(itemIds)) {
    const rows = await fetchAll(() =>
      sb().from("payroll_lines").select("id,payroll_item_id,code,description,nature,quantity,rate,amount,origin,sort").in("payroll_item_id", ids).order("payroll_item_id").order("sort"),
    );
    out.push(...(rows as Line[]));
  }
  return out;
}

export async function loadSlipsAndPayments(itemIds: string[]) {
  const slips: Slip[] = [];
  const payments: Payment[] = [];
  for (const ids of chunks(itemIds)) {
    const [s, p] = await Promise.all([
      sb().from("payslips").select("id,payroll_item_id,reference,issued_at").in("payroll_item_id", ids),
      sb().from("salary_payments").select("id,payroll_item_id,amount,paid_at,method,reference").in("payroll_item_id", ids).order("paid_at"),
    ]);
    slips.push(...((must(s) ?? []) as Slip[]));
    payments.push(...((must(p) ?? []) as Payment[]));
  }
  return { slips, payments };
}

/** Pré-processamento: dados de entrada do Supabase → motor (no navegador) → gravação da execução. */
export async function prepareRun(companyId: string, period: Period) {
  const input = await rpc<EngineInput>("ps_payroll_inputs", { p_company: companyId, p_year: period.year, p_month: period.month });
  const out = runPayroll(input);
  // A coluna payroll_lines.rate é numérica: taxas percentuais ("12%") são gravadas como número.
  const num = (v: string | null) => (v == null || v === "" ? null : v.replace(/%$/, ""));
  const items = out.items.map((i) => ({
    employeeId: i.employeeId,
    gross: i.gross,
    deductions: i.deductions,
    net: i.net,
    snapshot: {
      baseSalary: input.employees.find((e) => e.employeeId === i.employeeId)?.baseSalary ?? null,
      attendance: input.employees.find((e) => e.employeeId === i.employeeId)?.attendance ?? null,
      taxableBase: i.taxableBase,
      employerCosts: i.employerCosts,
    },
    lines: i.lines.map((l) => ({
      code: l.code,
      description: l.description,
      nature: l.nature,
      quantity: num(l.quantity),
      rate: num(l.rate),
      amount: l.amount,
      origin: l.origin,
      ruleVersionId: l.ruleVersionId,
      sort: l.sort,
    })),
  }));
  await rpc<string>("ps_payroll_save_run", {
    p_period: period.id,
    p_engine_version: out.engineVersion,
    p_input_hash: out.inputHash,
    p_totals: out.totals,
    p_warnings: out.warnings,
    p_items: items,
  });
  const runs = await loadRuns(period.id);
  return runs[0]?.version ?? 1;
}

/** Aprovação: recalcula o hash a partir dos dados actuais (detecta alterações desde o pré-processamento). */
export async function approveRun(companyId: string, period: Period, runId: string) {
  const input = await rpc<EngineInput>("ps_payroll_inputs", { p_company: companyId, p_year: period.year, p_month: period.month });
  await rpc("ps_payroll_approve", { p_run: runId, p_input_hash: hashInput(input) });
}

/** Gera o PDF de um recibo no navegador. */
export async function payslipBlob(args: { companyId: string; period: Period; run: Run; item: Item; lines: Line[]; slip: Slip }) {
  const company = must(await sb().from("companies").select("name,nuit,address").eq("id", args.companyId).single()) as {
    name: string;
    nuit: string | null;
    address: string | null;
  };
  const e = args.item.employees;
  const bytes = await renderPayslipPdf({
    reference: args.slip.reference,
    company,
    employee: {
      name: e?.full_name ?? "—",
      code: e?.employee_code ?? "—",
      jobTitle: e?.job_title ?? null,
      nuit: e?.nuit ?? null,
      department: e?.departments?.name ?? null,
    },
    period: { year: args.period.year, month: args.period.month },
    run: {
      version: args.run.version,
      engineVersion: args.run.engine_version,
      inputHash: args.run.input_hash,
      approvedAt: args.run.approved_at ? new Date(args.run.approved_at) : null,
    },
    currency: args.item.currency,
    lines: args.lines.map((l) => ({ code: l.code, description: l.description, nature: l.nature, quantity: l.quantity, amount: l.amount })),
    gross: args.item.gross,
    deductions: args.item.deductions,
    net: args.item.net,
    issuedAt: new Date(args.slip.issued_at),
  });
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
