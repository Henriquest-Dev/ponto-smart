import { describe, expect, it } from "vitest";
import { ROLES, isTeamScoped, roleHas } from "@/lib/auth/rbac";

describe("RBAC", () => {
  it("super admin não tem acesso a salários nem a dados de empresas", () => {
    expect(ROLES.super_admin.permissions.every((p) => p.startsWith("platform."))).toBe(true);
  });
  it("separação de funções: administrador não aprova salários nem regista pagamentos", () => {
    expect(roleHas("admin", "payroll.approve")).toBe(false);
    expect(roleHas("admin", "payments.register")).toBe(false);
  });
  it("RH prepara mas não aprova; financeiro aprova e paga mas não prepara", () => {
    expect(roleHas("hr", "payroll.prepare")).toBe(true);
    expect(roleHas("hr", "payroll.approve")).toBe(false);
    expect(roleHas("finance", "payroll.approve")).toBe(true);
    expect(roleHas("finance", "payments.register")).toBe(true);
    expect(roleHas("finance", "payroll.prepare")).toBe(false);
  });
  it("supervisor é limitado à equipa e não vê salários", () => {
    expect(isTeamScoped("supervisor")).toBe(true);
    expect(roleHas("supervisor", "employees.salary.view")).toBe(false);
    expect(roleHas("supervisor", "payroll.view")).toBe(false);
  });
  it("colaborador só tem permissões próprias", () => {
    expect(ROLES.employee.permissions.every((p) => p.startsWith("self."))).toBe(true);
  });
});
