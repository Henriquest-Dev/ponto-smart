"use client";

import { referencedIds, type AuditContext, type AuditRelated, type AuditRowInput } from "@/lib/audit-text";
import { sb } from "./client";

type Rec = Record<string, unknown>;

/** Consulta tolerante: sem permissão ou com erro devolve lista vazia (a frase usa então um texto genérico). */
async function safe(table: string, cols: string, column: string, values: string[]): Promise<Rec[]> {
  if (!values.length) return [];
  try {
    const res = await sb().from(table).select(cols).in(column, values);
    return res.error ? [] : ((res.data ?? []) as unknown as Rec[]);
  } catch {
    return [];
  }
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Carrega o que é preciso para nomear os alvos de uma página de auditoria:
 * colaborador de cada marcação/justificação/pagamento, mês de cada período/processamento
 * e nomes de colaboradores, rubricas, horários, locais e planos referidos nas linhas.
 */
export async function loadAuditContext(rows: AuditRowInput[]): Promise<AuditContext> {
  const byEntity = (e: string) => Array.from(new Set(rows.filter((r) => r.entity === e && r.entity_id).map((r) => r.entity_id as string)));
  const related: Record<string, AuditRelated> = {};

  const [events, days, absences, periods, runs, payments] = await Promise.all([
    safe("attendance_events", "id,employee_id", "id", byEntity("attendance_event")),
    safe("attendance_daily", "id,employee_id,work_date", "id", byEntity("attendance_daily")),
    safe("absence_requests", "id,employee_id", "id", byEntity("absence_request")),
    safe("payroll_periods", "id,year,month", "id", byEntity("payroll_period")),
    safe("payroll_runs", "id,period_id", "id", byEntity("payroll_run")),
    safe("salary_payments", "id,payroll_item_id", "id", byEntity("salary_payment")),
  ]);
  for (const r of [...events, ...absences]) related[r.id as string] = { employeeId: s(r.employee_id) };
  for (const r of days) related[r.id as string] = { employeeId: s(r.employee_id), date: s(r.work_date) };
  for (const r of periods) related[r.id as string] = { year: Number(r.year), month: Number(r.month) };

  const [runPeriods, items] = await Promise.all([
    safe("payroll_periods", "id,year,month", "id", Array.from(new Set(runs.map((r) => s(r.period_id)).filter((x): x is string => !!x)))),
    safe("payroll_items", "id,employee_id", "id", payments.map((p) => s(p.payroll_item_id)).filter((x): x is string => !!x)),
  ]);
  const periodById = new Map(runPeriods.map((p) => [p.id as string, p]));
  for (const r of runs) {
    const p = periodById.get(s(r.period_id) ?? "");
    related[r.id as string] = p ? { year: Number(p.year), month: Number(p.month) } : {};
  }
  const itemById = new Map(items.map((i) => [i.id as string, i]));
  for (const p of payments) related[p.id as string] = { employeeId: s(itemById.get(s(p.payroll_item_id) ?? "")?.employee_id) };

  const ids = new Set<string>();
  for (const r of rows) for (const id of referencedIds(r)) ids.add(id);
  for (const r of Object.values(related)) if (r.employeeId) ids.add(r.employeeId);
  const list = Array.from(ids);
  const planCodes = Array.from(
    new Set(rows.filter((r) => r.action === "subscription.plan_changed").map((r) => s((r.after as Rec | null)?.plan)).filter((x): x is string => !!x)),
  );

  const names: Record<string, string> = {};
  // Nomes que já vêm nas próprias linhas (útil quando a tabela não é legível, ex.: na plataforma).
  for (const r of rows) {
    if (r.entity !== "employees" || !r.entity_id) continue;
    const n = s((r.after as Rec | null)?.full_name) ?? s((r.before as Rec | null)?.full_name);
    if (n) names[r.entity_id] = n;
  }
  const lookups = await Promise.all([
    safe("employees", "id,full_name", "id", list),
    safe("payroll_components", "id,name", "id", list),
    safe("work_schedules", "id,name", "id", list),
    safe("work_locations", "id,name", "id", list),
    safe("branches", "id,name", "id", list),
    safe("departments", "id,name", "id", list),
    safe("subscription_plans", "id,name", "id", list),
    safe("users", "id,name", "id", list),
  ]);
  for (const rs of lookups) for (const r of rs) names[r.id as string] ??= s(r.full_name) ?? s(r.name) ?? "";
  for (const r of await safe("subscription_plans", "code,name", "code", planCodes)) if (s(r.code) && s(r.name)) names[r.code as string] = r.name as string;
  for (const k of Object.keys(names)) if (!names[k]) delete names[k];

  return { names, related };
}
