/**
 * Catálogo de permissões e papéis (fonte de verdade; espelhado nas tabelas
 * roles/permissions/role_permissions pelo seed).
 */
export const PERMISSIONS = {
  // Plataforma (Super Admin)
  "platform.companies.manage": { module: "plataforma", description: "Gerir empresas clientes" },
  "platform.plans.manage": { module: "plataforma", description: "Gerir planos e subscrições" },
  "platform.billing.manage": { module: "plataforma", description: "Gerir facturação SaaS" },
  "platform.health.view": { module: "plataforma", description: "Ver saúde e logs da plataforma" },
  // Empresa
  "company.settings.manage": { module: "empresa", description: "Configurar a empresa e políticas" },
  "users.manage": { module: "empresa", description: "Gerir contas e papéis" },
  "org.manage": { module: "empresa", description: "Gerir filiais e departamentos" },
  "employees.view": { module: "colaboradores", description: "Ver colaboradores" },
  "employees.manage": { module: "colaboradores", description: "Criar e editar colaboradores" },
  "employees.salary.view": { module: "colaboradores", description: "Ver e alterar salários" },
  "schedules.manage": { module: "horarios", description: "Gerir horários, turnos e feriados" },
  "locations.manage": { module: "locais", description: "Gerir locais, geofences e estações" },
  "stations.display": { module: "locais", description: "Abrir estação de QR dinâmico" },
  "attendance.view": { module: "assiduidade", description: "Ver assiduidade" },
  "attendance.manage": { module: "assiduidade", description: "Rever marcações e corrigir registos" },
  "absence.decide": { module: "justificacoes", description: "Decidir justificações (RH)" },
  "absence.decide.team": { module: "justificacoes", description: "Decidir justificações da equipa" },
  "payroll.view": { module: "salarios", description: "Consultar processamento salarial" },
  "payroll.prepare": { module: "salarios", description: "Preparar pré-processamento" },
  "payroll.approve": { module: "salarios", description: "Aprovar processamento salarial" },
  "payslips.issue": { module: "salarios", description: "Emitir recibos" },
  "payments.register": { module: "salarios", description: "Registar pagamentos" },
  "reports.view": { module: "relatorios", description: "Ver relatórios" },
  "reports.export": { module: "relatorios", description: "Exportar relatórios" },
  "audit.view": { module: "auditoria", description: "Consultar trilho de auditoria" },
  "ai.use": { module: "ia", description: "Usar o assistente administrativo" },
  // Colaborador
  "self.clock": { module: "colaborador", description: "Marcar ponto" },
  "self.history": { module: "colaborador", description: "Consultar o próprio histórico" },
  "self.absence": { module: "colaborador", description: "Submeter justificações" },
  "self.payslips": { module: "colaborador", description: "Consultar os próprios recibos" },
} as const;

export type Permission = keyof typeof PERMISSIONS;

const SELF: Permission[] = ["self.clock", "self.history", "self.absence", "self.payslips"];
const ALL_COMPANY = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => !p.startsWith("platform."));

export const ROLES = {
  super_admin: {
    name: "Super Administrador",
    description: "Opera a plataforma. Sem acesso salarial às empresas.",
    permissions: ["platform.companies.manage", "platform.plans.manage", "platform.billing.manage", "platform.health.view"],
  },
  owner: {
    name: "Proprietário",
    description: "Acesso total à empresa.",
    permissions: ALL_COMPANY,
  },
  admin: {
    name: "Administrador",
    description: "Gere a operação; não aprova salários nem regista pagamentos.",
    permissions: ALL_COMPANY.filter((p) => !["payroll.approve", "payments.register", "employees.salary.view"].includes(p)),
  },
  hr: {
    name: "Recursos Humanos",
    description: "Assiduidade, justificações e preparação salarial.",
    permissions: [
      "employees.view", "employees.manage", "employees.salary.view", "schedules.manage", "stations.display",
      "attendance.view", "attendance.manage", "absence.decide", "payroll.view", "payroll.prepare",
      "payslips.issue", "reports.view", "reports.export", "audit.view", "ai.use", ...SELF,
    ],
  },
  finance: {
    name: "Financeiro",
    description: "Aprova processamentos e regista pagamentos.",
    permissions: [
      "employees.view", "employees.salary.view", "attendance.view", "payroll.view", "payroll.approve",
      "payslips.issue", "payments.register", "reports.view", "reports.export", "audit.view", "ai.use", ...SELF,
    ],
  },
  supervisor: {
    name: "Supervisor",
    description: "Consulta e valida apenas a equipa autorizada.",
    permissions: ["employees.view", "attendance.view", "absence.decide.team", "stations.display", "reports.view", ...SELF],
  },
  employee: {
    name: "Colaborador",
    description: "Marcações, histórico, justificações e recibos próprios.",
    permissions: SELF,
  },
} satisfies Record<string, { name: string; description: string; permissions: Permission[] }>;

export type RoleCode = keyof typeof ROLES;

export function roleHas(role: RoleCode, permission: Permission): boolean {
  return (ROLES[role].permissions as readonly Permission[]).includes(permission);
}

/** Papéis cujo acesso se limita à equipa (departamentos geridos). */
export function isTeamScoped(role: RoleCode): boolean {
  return role === "supervisor";
}

/** Papéis que devem ter MFA quando a política da empresa o exige. */
export function isPrivilegedRole(role: RoleCode): boolean {
  return ["owner", "admin", "hr", "finance"].includes(role);
}

export function isStaffRole(role: RoleCode): boolean {
  return role !== "employee";
}
