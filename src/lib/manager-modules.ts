/** Funções avançadas que a empresa pode ligar a cada gerente (o estoque é básico: todos os gerentes têm). */
export type ManagerModule = { code: string; label: string; description: string };

export const MANAGER_MODULES: ManagerModule[] = [
  {
    code: "oficina",
    label: "Oficina e viaturas",
    description: "Registar viaturas pela matrícula, o que foi feito em cada entrada, procurar pelo histórico e exportar relatórios em PDF.",
  },
];

/** O utilizador pode usar esta função avançada? O proprietário e o administrador vêem as que a empresa tem ligadas. */
export function hasModule(m: { role: string; modules?: string[]; companyModules?: string[] } | null, code: string) {
  if (!m) return false;
  if (m.role === "manager") return (m.modules ?? []).includes(code);
  if (m.role === "owner" || m.role === "admin") return (m.companyModules ?? []).includes(code);
  return false;
}
