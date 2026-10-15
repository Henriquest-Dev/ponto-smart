import { describe, expect, it } from "vitest";
import { hashInput, runPayroll, type EngineInput } from "@/lib/domain/payroll/engine";
import { fromCents, pct, toCents } from "@/lib/domain/payroll/money";

const base: EngineInput = {
  period: { year: 2026, month: 9 },
  currency: "MZN",
  dailyDivisor: 30,
  overtimeComponent: { code: "HORAS_EXTRA", name: "Horas extra", nature: "earning", calcType: "per_hour", value: "1.5", taxable: true },
  rules: [
    { id: "r1", ruleCode: "INSS_TRAB", name: "INSS", version: 1, validated: false, params: { kind: "employee_contribution", ratePercent: null } },
  ],
  employees: [
    {
      employeeId: "e1", code: "A1", name: "Ana", baseSalary: "30000.00", weeklyHours: 40,
      attendance: { unjustifiedDays: 2, overtimeMinutes: 90, workedDays: 20 },
      components: [{ code: "SUB_TRANSP", name: "Subsídio de transporte", nature: "earning", calcType: "fixed", value: "1500.00", taxable: true }],
    },
  ],
};

describe("dinheiro em cêntimos", () => {
  it("arredonda meio para cima", () => {
    expect(toCents("10.005")).toBe(1001);
    expect(toCents("10.004")).toBe(1000);
    expect(fromCents(123456)).toBe("1234.56");
    expect(pct(toCents("1000.00"), 3)).toBe(3000);
  });
});

describe("motor salarial", () => {
  it("é determinístico (mesmo input → mesmo output e hash)", () => {
    const a = runPayroll(base);
    const b = runPayroll(structuredClone(base));
    expect(a).toEqual(b);
    expect(a.inputHash).toBe(hashInput(base));
  });

  it("o hash muda quando os dados mudam", () => {
    const changed = structuredClone(base);
    changed.employees[0].attendance.unjustifiedDays = 3;
    expect(hashInput(changed)).not.toBe(hashInput(base));
  });

  it("calcula base, ausência não remunerada, horas extra e subsídios", () => {
    const out = runPayroll(base);
    const item = out.items[0];
    const line = (code: string) => item.lines.find((l) => l.code === code)!;
    expect(line("SALARIO_BASE").amount).toBe("30000.00");
    // 2 dias × 30000/30 = 2000
    expect(line("AUSENCIA_NR").amount).toBe("2000.00");
    expect(line("AUSENCIA_NR").nature).toBe("deduction");
    // hora = 30000 / (40×52/12) = 173.08; × 1.5 = 259.62; × 1.5 h = 389.43
    expect(line("HORAS_EXTRA").amount).toBe("389.43");
    expect(line("SUB_TRANSP").amount).toBe("1500.00");
    expect(item.gross).toBe("31889.43");
    expect(item.net).toBe("29889.43");
  });

  it("não aplica retenções não validadas (e avisa)", () => {
    const out = runPayroll(base);
    expect(out.items[0].lines.some((l) => l.origin === "rule")).toBe(false);
    expect(out.warnings.some((w) => w.code === "rule_not_validated")).toBe(true);
  });

  it("aplica regras validadas: contribuição e imposto progressivo (valores ilustrativos)", () => {
    const input = structuredClone(base);
    input.employees[0].attendance = { unjustifiedDays: 0, overtimeMinutes: 0, workedDays: 22 };
    input.rules = [
      { id: "c", ruleCode: "CONTRIB", name: "Contribuição", version: 2, validated: true, params: { kind: "employee_contribution", ratePercent: 3 } },
      { id: "t", ruleCode: "IMPOSTO", name: "Imposto", version: 1, validated: true, params: { kind: "income_tax", brackets: [{ upTo: 20000, ratePercent: 0, deduction: 0 }, { upTo: null, ratePercent: 10, deduction: 2000 }] } },
      { id: "p", ruleCode: "ENCARGO", name: "Encargo patronal", version: 1, validated: true, params: { kind: "employer_contribution", ratePercent: 4 } },
    ];
    const item = runPayroll(input).items[0];
    // tributável = 31500; contribuição 3% = 945; base imposto = 30555 → 10% − 2000 = 1055.50
    expect(item.lines.find((l) => l.code === "CONTRIB")!.amount).toBe("945.00");
    expect(item.lines.find((l) => l.code === "IMPOSTO")!.amount).toBe("1055.50");
    expect(item.lines.find((l) => l.code === "CONTRIB")!.ruleVersionId).toBe("c");
    // encargo da entidade não desconta ao colaborador
    expect(item.employerCosts[0].amount).toBe("1260.00");
    expect(item.net).toBe("29499.50");
  });

  it("sem rubrica de horas extra: não paga automaticamente e avisa", () => {
    const input = structuredClone(base);
    input.overtimeComponent = null;
    const out = runPayroll(input);
    expect(out.items[0].lines.some((l) => l.code === "HORAS_EXTRA")).toBe(false);
    expect(out.warnings.some((w) => w.code === "overtime_unconfigured")).toBe(true);
  });

  it("colaborador sem acordo salarial é excluído com aviso", () => {
    const input = structuredClone(base);
    input.employees[0].baseSalary = null;
    const out = runPayroll(input);
    expect(out.items).toHaveLength(0);
    expect(out.warnings[1].code).toBe("no_salary");
  });
});
