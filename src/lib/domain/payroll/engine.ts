/**
 * Motor salarial determinístico e versionado.
 *
 * - Função pura: o mesmo input produz sempre o mesmo output (e o mesmo hash).
 * - NÃO contém taxas legais embutidas. Retenções (INSS/IRPS ou outras) só são
 *   aplicadas a partir de `payroll_rule_versions` marcadas como validadas por um
 *   profissional; caso contrário é emitido um aviso e nada é retido.
 * - NÃO aplica multas por atraso. Faltas injustificadas validadas por um
 *   responsável geram apenas "ausência não remunerada".
 */
import { sha256Hex } from "@/lib/sha256";
import { fromCents, mul, pct, toCents, type Cents } from "./money";

export type RuleParams = {
  /** Natureza: contribuição do trabalhador, imposto sobre o rendimento ou encargo da entidade patronal. */
  kind: "employee_contribution" | "income_tax" | "employer_contribution";
  /** Percentagem sobre a base (ex.: contribuição). */
  ratePercent?: number | null;
  /** Escalões progressivos: até `upTo` (null = sem limite), taxa em %, parcela a abater. */
  brackets?: { upTo: number | null; ratePercent: number; deduction: number }[];
  note?: string;
};

export const ENGINE_VERSION = "ps-payroll/1.0.0";

export type EngineComponent = {
  code: string;
  name: string;
  nature: "earning" | "deduction";
  calcType: "fixed" | "percent_base" | "per_hour";
  /** fixed: valor; percent_base: percentagem; per_hour: multiplicador. */
  value: string;
  taxable: boolean;
};

export type EngineRule = {
  id: string;
  ruleCode: string;
  name: string;
  version: number;
  validated: boolean;
  params: RuleParams;
};

export type EngineEmployee = {
  employeeId: string;
  code: string;
  name: string;
  baseSalary: string | null;
  weeklyHours: number;
  attendance: { unjustifiedDays: number; overtimeMinutes: number; workedDays: number };
  components: EngineComponent[];
};

export type EngineInput = {
  period: { year: number; month: number };
  currency: string;
  dailyDivisor: number;
  overtimeComponent: EngineComponent | null;
  rules: EngineRule[];
  employees: EngineEmployee[];
};

export type EngineLine = {
  code: string;
  description: string;
  nature: "earning" | "deduction";
  quantity: string | null;
  rate: string | null;
  amount: string;
  origin: "contract" | "attendance" | "component" | "rule";
  ruleVersionId: string | null;
  sort: number;
};

export type EngineItem = {
  employeeId: string;
  gross: string;
  deductions: string;
  net: string;
  taxableBase: string;
  lines: EngineLine[];
  employerCosts: { code: string; description: string; amount: string; ruleVersionId: string }[];
};

export type EngineWarning = { employeeId?: string; code: string; message: string };

export type EngineOutput = {
  engineVersion: string;
  inputHash: string;
  items: EngineItem[];
  warnings: EngineWarning[];
  totals: { gross: string; deductions: string; net: string; employees: number };
};

/** JSON canónico (chaves ordenadas) para hash reprodutível. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashInput(input: EngineInput): string {
  return sha256Hex(`${ENGINE_VERSION}|${canonicalJson(input)}`);
}

function progressiveTax(base: Cents, brackets: NonNullable<RuleParams["brackets"]>): Cents {
  const bracket = brackets.find((b) => b.upTo === null || base <= toCents(b.upTo));
  if (!bracket) return 0;
  return Math.max(0, pct(base, bracket.ratePercent) - toCents(bracket.deduction));
}

export function runPayroll(input: EngineInput): EngineOutput {
  const warnings: EngineWarning[] = [];
  const items: EngineItem[] = [];

  for (const rule of input.rules) {
    if (!rule.validated) {
      warnings.push({
        code: "rule_not_validated",
        message: `Regra "${rule.name}" (v${rule.version}) não validada por especialista — não foi aplicada.`,
      });
    }
  }

  const employees = [...input.employees].sort((a, b) => a.code.localeCompare(b.code));
  for (const emp of employees) {
    if (!emp.baseSalary) {
      warnings.push({ employeeId: emp.employeeId, code: "no_salary", message: `${emp.name}: sem acordo salarial vigente no período.` });
      continue;
    }
    const lines: EngineLine[] = [];
    let sort = 0;
    const base = toCents(emp.baseSalary);
    lines.push({
      code: "SALARIO_BASE", description: "Salário base", nature: "earning",
      quantity: "1", rate: fromCents(base), amount: fromCents(base), origin: "contract", ruleVersionId: null, sort: sort++,
    });

    let taxable = base;
    const daily = mul(base, 1 / input.dailyDivisor);

    // Ausência não remunerada (faltas injustificadas validadas) — não é multa.
    if (emp.attendance.unjustifiedDays > 0) {
      const amount = mul(daily, emp.attendance.unjustifiedDays);
      taxable -= amount;
      lines.push({
        code: "AUSENCIA_NR", description: "Ausência não remunerada (faltas injustificadas validadas)", nature: "deduction",
        quantity: String(emp.attendance.unjustifiedDays), rate: fromCents(daily), amount: fromCents(amount),
        origin: "attendance", ruleVersionId: null, sort: sort++,
      });
    }

    // Horas extraordinárias — só com rubrica configurada pela empresa.
    if (emp.attendance.overtimeMinutes > 0) {
      if (input.overtimeComponent) {
        const monthlyHours = (emp.weeklyHours * 52) / 12;
        const hourly = mul(base, 1 / monthlyHours);
        const factor = Number(input.overtimeComponent.value);
        const hours = Math.round((emp.attendance.overtimeMinutes / 60) * 100) / 100;
        const amount = mul(mul(hourly, factor), hours);
        if (input.overtimeComponent.taxable) taxable += amount;
        lines.push({
          code: input.overtimeComponent.code, description: input.overtimeComponent.name, nature: "earning",
          quantity: hours.toFixed(2), rate: fromCents(mul(hourly, factor)), amount: fromCents(amount),
          origin: "attendance", ruleVersionId: null, sort: sort++,
        });
      } else {
        warnings.push({
          employeeId: emp.employeeId, code: "overtime_unconfigured",
          message: `${emp.name}: ${emp.attendance.overtimeMinutes} min de horas extra sem rubrica configurada (não pagas automaticamente).`,
        });
      }
    }

    // Rubricas atribuídas (subsídios, adiantamentos, descontos autorizados).
    const components = [...emp.components].sort((a, b) => a.code.localeCompare(b.code));
    for (const c of components) {
      const amount = c.calcType === "percent_base" ? pct(base, Number(c.value)) : toCents(c.value);
      if (c.nature === "earning" && c.taxable) taxable += amount;
      lines.push({
        code: c.code, description: c.name, nature: c.nature,
        quantity: c.calcType === "percent_base" ? c.value : "1",
        rate: c.calcType === "percent_base" ? `${c.value}%` : fromCents(amount),
        amount: fromCents(amount), origin: "component", ruleVersionId: null, sort: sort++,
      });
    }

    taxable = Math.max(0, taxable);
    const employerCosts: EngineItem["employerCosts"] = [];

    // Retenções legais — apenas regras validadas.
    let contributions: Cents = 0;
    for (const rule of input.rules.filter((r) => r.validated && r.params.kind === "employee_contribution")) {
      if (rule.params.ratePercent == null) continue;
      const amount = pct(taxable, rule.params.ratePercent);
      contributions += amount;
      lines.push({
        code: rule.ruleCode, description: rule.name, nature: "deduction",
        quantity: fromCents(taxable), rate: `${rule.params.ratePercent}%`, amount: fromCents(amount),
        origin: "rule", ruleVersionId: rule.id, sort: sort++,
      });
    }
    for (const rule of input.rules.filter((r) => r.validated && r.params.kind === "income_tax")) {
      if (!rule.params.brackets?.length) continue;
      const base2 = Math.max(0, taxable - contributions);
      const amount = progressiveTax(base2, rule.params.brackets);
      if (amount > 0) {
        lines.push({
          code: rule.ruleCode, description: rule.name, nature: "deduction",
          quantity: fromCents(base2), rate: null, amount: fromCents(amount),
          origin: "rule", ruleVersionId: rule.id, sort: sort++,
        });
      }
    }
    for (const rule of input.rules.filter((r) => r.validated && r.params.kind === "employer_contribution")) {
      if (rule.params.ratePercent == null) continue;
      employerCosts.push({ code: rule.ruleCode, description: rule.name, amount: fromCents(pct(taxable, rule.params.ratePercent)), ruleVersionId: rule.id });
    }

    const gross = lines.filter((l) => l.nature === "earning").reduce((s, l) => s + toCents(l.amount), 0);
    const deductions = lines.filter((l) => l.nature === "deduction").reduce((s, l) => s + toCents(l.amount), 0);
    const net = gross - deductions;
    if (net < 0) {
      warnings.push({ employeeId: emp.employeeId, code: "negative_net", message: `${emp.name}: valor líquido negativo — rever descontos.` });
    }
    items.push({
      employeeId: emp.employeeId,
      gross: fromCents(gross),
      deductions: fromCents(deductions),
      net: fromCents(net),
      taxableBase: fromCents(taxable),
      lines,
      employerCosts,
    });
  }

  const sum = (k: "gross" | "deductions" | "net") => fromCents(items.reduce((s, i) => s + toCents(i[k]), 0));
  return {
    engineVersion: ENGINE_VERSION,
    inputHash: hashInput(input),
    items,
    warnings,
    totals: { gross: sum("gross"), deductions: sum("deductions"), net: sum("net"), employees: items.length },
  };
}
