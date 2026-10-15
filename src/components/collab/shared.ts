"use client";

import * as React from "react";
import type { DailyStatus, EventType } from "@/lib/domain/attendance-rules";
import { must, sb } from "@/lib/sb/client";
import { monthRange } from "@/lib/time";

/** Título do separador do navegador (as páginas cliente não exportam `metadata`). */
export function useTitle(title: string) {
  React.useEffect(() => {
    document.title = `${title} · PontoSmart`;
  }, [title]);
}

export type DailyRow = {
  id: string;
  work_date: string;
  expected_start: string | null;
  expected_end: string | null;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  break_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  status: DailyStatus;
  locked: boolean;
};

export const DAILY_COLS =
  "id,work_date,expected_start,expected_end,first_in,last_out,worked_minutes,break_minutes,late_minutes,overtime_minutes,status,locked";

export type EventStatus = "accepted" | "review" | "rejected";

/** Estado actual devolvido por `ps_my_status`. */
export type MyStatus = {
  employeeId: string;
  lastType: EventType | null;
  lastAt: string | null;
  lastStatus: EventStatus | null;
  workDate: string | null;
};

export type ClockState = "off" | "working" | "break";

export function clockState(s: MyStatus | null | undefined): ClockState {
  if (!s?.lastType || s.lastType === "out") return "off";
  return s.lastType === "break_start" ? "break" : "working";
}

/** Dias de assiduidade do mês (mais recentes primeiro). */
export async function loadMonthDays(companyId: string, employeeId: string, ym: string): Promise<DailyRow[]> {
  const [y, m] = ym.split("-").map(Number);
  const { from, to } = monthRange(y, m);
  return must(
    await sb()
      .from("attendance_daily")
      .select(DAILY_COLS)
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: false }),
  ) as DailyRow[];
}

export function summarize(days: DailyRow[]) {
  const worked = days.filter((d) => d.worked_minutes > 0 || d.first_in);
  const scheduled = days.filter((d) => !["holiday", "day_off"].includes(d.status));
  const late = days.filter((d) => d.status === "late").length;
  const onTime = days.filter((d) => d.status === "on_time").length;
  return {
    workedDays: worked.length,
    workedMinutes: days.reduce((s, d) => s + d.worked_minutes, 0),
    overtimeMinutes: days.reduce((s, d) => s + d.overtime_minutes, 0),
    late,
    absences: days.filter((d) => ["absent_pending", "unjustified"].includes(d.status)).length,
    justified: days.filter((d) => d.status === "justified").length,
    punctuality: onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 1000) / 10 : null,
    scheduledDays: scheduled.length,
  };
}

export const ABSENCE_TYPES: Record<string, string> = {
  doenca: "Doença",
  consulta: "Consulta médica",
  falecimento: "Falecimento de familiar",
  casamento: "Casamento",
  parentalidade: "Parentalidade",
  formacao: "Formação / exames",
  servico: "Serviço externo",
  outro: "Outro motivo",
};

/** Dias por justificar / com ocorrência (não fechados), mais recentes primeiro. */
export async function loadPendingDays(companyId: string, employeeId: string) {
  return must(
    await sb()
      .from("attendance_daily")
      .select("id,work_date,status")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .in("status", ["absent_pending", "incomplete", "late"])
      .eq("locked", false)
      .order("work_date", { ascending: false })
      .limit(10),
  ) as { id: string; work_date: string; status: DailyStatus }[];
}

/** Ano/mês de um recibo a partir da referência "RV-AAAAMM-…" (os períodos não são legíveis pelo colaborador). */
export function periodFromReference(reference: string): { year: number; month: number } | null {
  const m = /^RV-(\d{4})(\d{2})-/.exec(reference);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export type One<T> = T | T[] | null;
export const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export type MyPayslip = {
  id: string;
  reference: string;
  issuedAt: string;
  itemId: string;
  year: number;
  month: number;
  gross: string;
  deductions: string;
  net: string;
  currency: string;
  run: { version: number; engineVersion: string; inputHash: string; approvedAt: string | null } | null;
  acknowledgedAt: string | null;
  payment: { paidAt: string; method: string } | null;
};

type PayslipRow = {
  id: string;
  reference: string;
  issued_at: string;
  payroll_item_id: string;
  payroll_items: One<{ gross: string; deductions: string; net: string; currency: string }>;
  payroll_runs: One<{
    version: number;
    engine_version: string;
    input_hash: string;
    approved_at: string | null;
    payroll_periods: One<{ year: number; month: number }>;
  }>;
  payslip_acknowledgements: One<{ acknowledged_at: string }>;
};

/** Recibos emitidos para o próprio colaborador (mais recentes primeiro). */
export async function loadMyPayslips(companyId: string, employeeId: string): Promise<MyPayslip[]> {
  const rows = must(
    await sb()
      .from("payslips")
      .select(
        "id,reference,issued_at,payroll_item_id,payroll_items(gross,deductions,net,currency),payroll_runs(version,engine_version,input_hash,approved_at,payroll_periods(year,month)),payslip_acknowledgements(acknowledged_at)",
      )
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("issued_at", { ascending: false }),
  ) as unknown as PayslipRow[];

  // Pagamentos: só visíveis se as regras (RLS) o permitirem; sem acesso, a lista vem vazia.
  const itemIds = rows.map((r) => r.payroll_item_id);
  const payments = itemIds.length
    ? ((await sb().from("salary_payments").select("payroll_item_id,paid_at,method").in("payroll_item_id", itemIds)).data ?? [])
    : [];

  const out = rows.map((r): MyPayslip => {
    const item = one(r.payroll_items);
    const run = one(r.payroll_runs);
    const issued = new Date(r.issued_at);
    const period = one(run?.payroll_periods ?? null) ??
      periodFromReference(r.reference) ?? { year: issued.getUTCFullYear(), month: issued.getUTCMonth() + 1 };
    const pay = (payments as { payroll_item_id: string; paid_at: string; method: string }[]).find((p) => p.payroll_item_id === r.payroll_item_id);
    return {
      id: r.id,
      reference: r.reference,
      issuedAt: r.issued_at,
      itemId: r.payroll_item_id,
      year: period.year,
      month: period.month,
      gross: item?.gross ?? "0",
      deductions: item?.deductions ?? "0",
      net: item?.net ?? "0",
      currency: item?.currency ?? "MZN",
      run: run ? { version: run.version, engineVersion: run.engine_version, inputHash: run.input_hash, approvedAt: run.approved_at } : null,
      acknowledgedAt: one(r.payslip_acknowledgements)?.acknowledged_at ?? null,
      payment: pay ? { paidAt: pay.paid_at, method: pay.method } : null,
    };
  });
  return out.sort((a, b) => b.year - a.year || b.month - a.month || b.issuedAt.localeCompare(a.issuedAt));
}
