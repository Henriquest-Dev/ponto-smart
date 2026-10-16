import { describe, expect, it } from "vitest";
import { actionsForCategory, describeAudit, isNoise } from "@/lib/audit-text";

const ANA = "11111111-1111-4111-8111-111111111111";
const EV = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const sp = (s: string) => s.replace(/\s/g, " ");

describe("describeAudit", () => {
  it("criação de colaborador", () => {
    const t = describeAudit({ action: "employees.insert", entity: "employees", entity_id: ANA, before: null, after: { id: ANA, full_name: "Ana Macuácua" } });
    expect(t).toEqual({ category: "Pessoas", sentence: "criou o colaborador Ana Macuácua", changes: [] });
  });

  it("novo acordo salarial usa o nome do colaborador", () => {
    const t = describeAudit(
      { action: "salary_agreements.insert", entity: "salary_agreements", entity_id: "x", before: null, after: { employee_id: ANA, amount: 18500, currency: "MZN" } },
      { names: { [ANA]: "Ana Macuácua" } },
    );
    expect(t.category).toBe("Salários");
    expect(sp(t.sentence)).toBe("alterou o salário base de Ana Macuácua para 18 500,00 MZN");
  });

  it("alteração de estação mostra só os campos relevantes", () => {
    const before = { id: "s", company_id: "c", name: "Recepção da loja", qr_mode: "dynamic", last_seen_at: "2026-10-01T08:00:00Z", static_token_hash: "a" };
    const after = { ...before, qr_mode: "static", last_seen_at: "2026-10-01T09:00:00Z", static_token_hash: "b" };
    const t = describeAudit({ action: "attendance_stations.update", entity: "attendance_stations", entity_id: "s", before, after });
    expect(t.sentence).toBe("alterou a estação Recepção da loja (modo do QR)");
    expect(t.changes).toEqual([{ label: "Modo do QR", before: "Dinâmico", after: "Fixo" }]);
  });

  it("revisão de marcação e processamento salarial", () => {
    const ctx = { names: { [ANA]: "Celso Nhantumbo" }, related: { [EV]: { employeeId: ANA }, [RUN]: { year: 2026, month: 9 } } };
    const r = describeAudit(
      { action: "attendance.reviewed", entity: "attendance_event", entity_id: EV, before: { status: "review" }, after: { status: "accepted", reason: "Ok" } },
      ctx,
    );
    expect(r.sentence).toBe("reviu uma marcação de Celso Nhantumbo (aceite)");
    expect(r.category).toBe("Assiduidade");
    const p = describeAudit({ action: "payroll.run_prepared", entity: "payroll_run", entity_id: RUN, before: null, after: { version: 1 } }, ctx);
    expect(p.sentence).toBe("preparou o processamento salarial de Setembro de 2026");
  });

  it("justificação aprovada e acção desconhecida", () => {
    const a = describeAudit({ action: "absence.approved", entity: "absence_request", entity_id: EV, before: null, after: { reason: "Atestado" } }, { names: { [ANA]: "Inácio Chissano" }, related: { [EV]: { employeeId: ANA } } });
    expect(a.sentence).toBe("aprovou a justificação de Inácio Chissano");
    expect(a.category).toBe("Justificações");
    const u = describeAudit({ action: "foo.bar_baz", entity: "something", entity_id: null, before: null, after: null });
    expect(u.sentence).not.toContain("foo");
    expect(u.sentence.length).toBeGreaterThan(5);
  });
});

describe("isNoise", () => {
  it("batimento da estação é ruído; alteração real não", () => {
    const before = { id: "s", name: "Recepção", qr_mode: "dynamic", last_seen_at: "2026-10-01T08:00:00Z" };
    expect(isNoise({ action: "attendance_stations.update", entity: "attendance_stations", entity_id: "s", before, after: { ...before, last_seen_at: "2026-10-01T08:00:30Z" } })).toBe(true);
    expect(isNoise({ action: "attendance_stations.update", entity: "attendance_stations", entity_id: "s", before, after: { ...before, name: "Entrada" } })).toBe(false);
    expect(isNoise({ action: "employees.insert", entity: "employees", entity_id: "e", before: null, after: { full_name: "X" } })).toBe(false);
  });
});

describe("actionsForCategory", () => {
  it("inclui acções de trigger e explícitas", () => {
    const s = actionsForCategory("Salários");
    expect(s).toContain("salary_agreements.insert");
    expect(s).toContain("payroll.run_approved");
    expect(s).not.toContain("employees.insert");
  });
});
