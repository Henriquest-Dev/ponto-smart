/**
 * Trilho de auditoria legível: transforma uma linha de `audit_logs` numa frase em português
 * ("criou o colaborador Ana Macuácua"), numa categoria e na lista de campos alterados.
 * Funções puras (sem base de dados) — testadas em tests/audit-text.test.ts.
 */
import { DAILY_STATUS_LABEL } from "@/lib/domain/attendance-rules";
import { MONTHS_PT } from "@/lib/format";

export type AuditCategory = "Pessoas" | "Assiduidade" | "Justificações" | "Salários" | "Gestão" | "Configuração" | "Acessos" | "Plataforma";

export const AUDIT_CATEGORIES: AuditCategory[] = ["Pessoas", "Assiduidade", "Justificações", "Salários", "Gestão", "Configuração", "Acessos", "Plataforma"];

export type AuditRowInput = {
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
};

/** Dados de outras tabelas que ajudam a nomear o alvo (carregados pela página, opcionais). */
export type AuditRelated = { employeeId?: string; year?: number; month?: number; date?: string };

export type AuditContext = {
  /** Nomes por id (colaboradores, rubricas, locais, horários, planos…). */
  names?: Record<string, string>;
  /** Por `entity_id` de acções explícitas (marcação, dia, justificação, período, processamento, pagamento). */
  related?: Record<string, AuditRelated>;
};

export type AuditChange = { label: string; before: string; after: string };

export type AuditText = { category: AuditCategory; sentence: string; changes: AuditChange[] };

type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Tabelas com trigger de auditoria
 * ------------------------------------------------------------------ */

type Noun = { def: string; indef: string; noun: string; category: AuditCategory; nameKey?: string };

const TABLES: Record<string, Noun> = {
  companies: { def: "a", indef: "uma", noun: "empresa", category: "Configuração" },
  branches: { def: "a", indef: "uma", noun: "filial", category: "Configuração" },
  departments: { def: "o", indef: "um", noun: "departamento", category: "Configuração" },
  employees: { def: "o", indef: "um", noun: "colaborador", category: "Pessoas", nameKey: "full_name" },
  salary_agreements: { def: "o", indef: "um", noun: "acordo salarial", category: "Salários" },
  employee_components: { def: "a", indef: "uma", noun: "rubrica", category: "Salários" },
  payroll_components: { def: "a", indef: "uma", noun: "rubrica", category: "Salários" },
  work_locations: { def: "o", indef: "um", noun: "local", category: "Configuração" },
  attendance_stations: { def: "a", indef: "uma", noun: "estação", category: "Configuração" },
  work_schedules: { def: "o", indef: "um", noun: "horário", category: "Configuração" },
  holidays: { def: "o", indef: "um", noun: "feriado", category: "Configuração" },
  shift_assignments: { def: "o", indef: "um", noun: "horário atribuído", category: "Pessoas" },
  subscription_plans: { def: "o", indef: "um", noun: "plano", category: "Plataforma" },
  subscriptions: { def: "a", indef: "uma", noun: "subscrição", category: "Plataforma" },
};

const TRIGGER_OPS = ["insert", "update", "delete"] as const;

/* ------------------------------------------------------------------ *
 * Acções explícitas (ps_audit_log)
 * ------------------------------------------------------------------ */

const EXPLICIT: Record<string, AuditCategory> = {
  "company.provisioned": "Plataforma",
  "company_request.rejected": "Plataforma",
  "company.status_changed": "Plataforma",
  "subscription.plan_changed": "Plataforma",
  "user.password_reset": "Acessos",
  "employee.access_set": "Acessos",
  "employee.access_removed": "Acessos",
  "attendance.reviewed": "Assiduidade",
  "attendance.adjusted": "Assiduidade",
  "absence.created": "Justificações",
  "absence.approved": "Justificações",
  "absence.rejected": "Justificações",
  "absence.step_approved": "Justificações",
  "payroll.attendance_closed": "Assiduidade",
  "payroll.attendance_reopened": "Assiduidade",
  "payroll.run_prepared": "Salários",
  "payroll.run_approved": "Salários",
  "payroll.period_closed": "Salários",
  "payroll.payslips_issued": "Salários",
  "payroll.payment_registered": "Salários",
  "report.exported": "Pessoas",
  "qr.created": "Configuração",
  "ai.owner_notified": "Configuração",
  "qr.regenerated": "Configuração",
  "qr.window_changed": "Configuração",
  "clock_link.created": "Assiduidade",
  "clock_link.updated": "Assiduidade",
  "clock_link.deleted": "Assiduidade",
  "clock_link.shown": "Assiduidade",
  "clock_link.hidden": "Assiduidade",
  "employee.modules_set": "Acessos",
  "stock.item_create": "Gestão",
  "stock.item_update": "Gestão",
  "stock.item_archive": "Gestão",
  "stock.item_restore": "Gestão",
  "vehicle.create": "Gestão",
  "vehicle.update": "Gestão",
  "vehicle.visit_open": "Gestão",
  "vehicle.visit_save": "Gestão",
  "vehicle.visit_delete": "Gestão",
};

/** Todas as acções conhecidas de uma categoria (para filtrar na base de dados). */
export function actionsForCategory(category: AuditCategory): string[] {
  const out: string[] = [];
  for (const [table, n] of Object.entries(TABLES)) {
    if (n.category === category) for (const op of TRIGGER_OPS) out.push(`${table}.${op}`);
  }
  for (const [action, c] of Object.entries(EXPLICIT)) if (c === category) out.push(action);
  return out;
}

/* ------------------------------------------------------------------ *
 * Campos
 * ------------------------------------------------------------------ */

const SKIP = new Set(["id", "company_id", "created_at", "updated_at", "last_seen_at", "center", "geom", "created_by"]);

function skipField(key: string) {
  return SKIP.has(key) || /(_hash|hash|token|secret|password)$/i.test(key);
}

const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  full_name: "Nome",
  legal_name: "Denominação social",
  nuit: "NUIT",
  email: "Email",
  phone: "Telefone",
  address: "Morada",
  city: "Cidade",
  timezone: "Fuso horário",
  currency: "Moeda",
  status: "Estado",
  employee_code: "Número",
  job_title: "Função",
  department_id: "Departamento",
  branch_id: "Filial",
  hire_date: "Data de admissão",
  bank_account: "Conta bancária",
  user_id: "Conta de acesso",
  manager_user_id: "Responsável",
  employee_id: "Colaborador",
  amount: "Valor",
  effective_from: "Em vigor desde",
  effective_to: "Em vigor até",
  component_id: "Rubrica",
  note: "Nota",
  code: "Código",
  nature: "Natureza",
  calc_type: "Cálculo",
  rate: "Taxa",
  taxable: "Sujeita a IRPS",
  active: "Activo",
  center_lat: "Latitude",
  center_lng: "Longitude",
  radius_m: "Raio (m)",
  max_accuracy_m: "Precisão máxima do GPS (m)",
  location_id: "Local",
  qr_mode: "Modo do QR",
  rotation_seconds: "Rotação do QR (s)",
  tolerance_minutes: "Tolerância (min)",
  date: "Data",
  recurring: "Repete todos os anos",
  schedule_id: "Horário",
  valid_from: "Válido desde",
  valid_to: "Válido até",
  price_monthly: "Preço mensal",
  max_employees: "Máximo de colaboradores",
  modules: "Módulos",
  plan_id: "Plano",
  billing_cycle: "Facturação",
  current_period_start: "Início do período",
  current_period_end: "Fim do período",
  reason: "Fundamento",
  window_start: "QR válido desde",
  window_end: "QR válido até",
};

const SETTINGS_LABEL: Record<string, string> = {
  devicePolicy: "Política de dispositivos",
  absenceFlow: "Circuito das justificações",
  requireMfaForAdmins: "Verificação em dois passos para administradores",
  duplicateWindowMinutes: "Intervalo entre marcações repetidas (min)",
  payrollDailyDivisor: "Divisor diário do salário",
};

const ENUM_VALUE: Record<string, Record<string, string>> = {
  "employees.status": { active: "Activo", inactive: "Inactivo", terminated: "Desvinculado" },
  "companies.status": { trial: "Em experiência", active: "Activa", suspended: "Suspensa", cancelled: "Cancelada" },
  "subscriptions.status": { trialing: "Em experiência", active: "Activa", past_due: "Pagamento em atraso", cancelled: "Cancelada" },
  qr_mode: { dynamic: "Dinâmico", static: "Fixo" },
  nature: { earning: "Abono", deduction: "Desconto" },
  calc_type: { fixed: "Valor fixo", percent_base: "Percentagem do salário base", per_hour: "Por hora" },
  billing_cycle: { monthly: "Mensal", yearly: "Anual", annual: "Anual" },
  devicePolicy: { warn: "Avisar", block: "Bloquear", off: "Desligada", none: "Desligada" },
  absenceFlow: { supervisor_then_hr: "Supervisor e depois RH", hr_only: "Só RH", hr: "Só RH" },
};

const MONEY_FIELDS = new Set(["amount", "price_monthly"]);

const STATUS_COMPANY: Record<string, string> = ENUM_VALUE["companies.status"];

const ROLE: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  hr: "Recursos Humanos",
  finance: "Financeiro",
  supervisor: "Supervisor",
  manager: "Gerente",
  employee: "Colaborador",
};

const ABSENCE_TYPE: Record<string, string> = {
  doenca: "doença",
  consulta: "consulta médica",
  falecimento: "falecimento de familiar",
  casamento: "casamento",
  parentalidade: "parentalidade",
  formacao: "formação / exames",
  servico: "serviço externo",
  outro: "outro motivo",
};

const PAYMENT_METHOD: Record<string, string> = {
  transferencia: "transferência bancária",
  mpesa: "M-Pesa",
  emola: "e-Mola",
  numerario: "numerário",
  cheque: "cheque",
};

const EVENT_STATUS: Record<string, string> = { accepted: "Validada", review: "Em revisão", rejected: "Rejeitada" };

/* ------------------------------------------------------------------ *
 * Formatação
 * ------------------------------------------------------------------ */

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

export function formatMzn(value: unknown, currency = "MZN"): string {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;
}

function formatDay(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_PT[month - 1] ?? month} de ${year}`;
}

function lowerFirst(s: string) {
  return /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function humanizeKey(key: string) {
  const s = key
    .replace(/_id$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatValue(table: string, key: string, v: unknown, ctx: AuditContext, currency?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const e = ENUM_VALUE[`${table}.${key}`] ?? ENUM_VALUE[key];
  if (e && typeof v === "string") return e[v] ?? v;
  if (MONEY_FIELDS.has(key)) return formatMzn(v, currency);
  if (isUuid(v)) return ctx.names?.[v] ?? (key === "user_id" ? "Associada" : "Outro registo");
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : "…")).join(", ") : "—";
  if (typeof v === "object") return "Alterado";
  if (typeof v === "number") return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 6 }).format(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDay(s);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDay(s);
  return s;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Campos relevantes que mudaram entre `before` e `after` (actualizações de tabelas com trigger). */
function diff(table: string, before: Json, after: Json, ctx: AuditContext): AuditChange[] {
  const out: AuditChange[] = [];
  const currency = str(after.currency) ?? str(before.currency);
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  for (const key of keys) {
    if (skipField(key) || same(before[key], after[key])) continue;
    // Definições da empresa: uma linha por chave alterada.
    if (key === "settings") {
      const b = obj(before[key]) ?? {};
      const a = obj(after[key]) ?? {};
      for (const k of Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))) {
        if (same(b[k], a[k])) continue;
        out.push({ label: SETTINGS_LABEL[k] ?? humanizeKey(k), before: formatValue(table, k, b[k], ctx), after: formatValue(table, k, a[k], ctx) });
      }
      continue;
    }
    out.push({
      label: FIELD_LABEL[key] ?? humanizeKey(key),
      before: formatValue(table, key, before[key], ctx, currency),
      after: formatValue(table, key, after[key], ctx, currency),
    });
  }
  return out;
}

/** Lista de campos para a frase: "(modo do QR)", "(nome, raio)". */
function fieldList(changes: AuditChange[]) {
  if (!changes.length) return "";
  const names = Array.from(new Set(changes.map((c) => lowerFirst(c.label))));
  return ` (${names.slice(0, 3).join(", ")}${names.length > 3 ? " e outros" : ""})`;
}

/* ------------------------------------------------------------------ *
 * Ruído
 * ------------------------------------------------------------------ */

/** Linhas sem interesse para o utilizador: batimento das estações e actualizações sem alterações relevantes. */
export function isNoise(row: AuditRowInput): boolean {
  const [table, op] = splitAction(row.action);
  if (op !== "update" || !TABLES[table]) return false;
  const before = obj(row.before);
  const after = obj(row.after);
  if (!before || !after) return false;
  return diff(table, before, after, {}).length === 0;
}

function splitAction(action: string): [string, string] {
  const i = action.lastIndexOf(".");
  return i < 0 ? [action, ""] : [action.slice(0, i), action.slice(i + 1)];
}

/* ------------------------------------------------------------------ *
 * Frases
 * ------------------------------------------------------------------ */

function nameOf(table: string, row: Json | null): string | undefined {
  if (!row) return undefined;
  const n = TABLES[table];
  return str(row[n?.nameKey ?? "name"]) ?? str(row.full_name) ?? str(row.name);
}

function target(n: Noun, name: string | undefined) {
  return name ? `${n.def} ${n.noun} ${name}` : `${n.indef} ${n.noun}`;
}

function employeeName(id: unknown, ctx: AuditContext): string | undefined {
  return isUuid(id) ? ctx.names?.[id] : undefined;
}

/** "de Ana Macuácua" / "de um colaborador". */
function ofEmployee(name: string | undefined) {
  return name ? `de ${name}` : "de um colaborador";
}

function toEmployee(name: string | undefined) {
  return name ? `a ${name}` : "a um colaborador";
}

function describeTrigger(table: string, op: string, row: AuditRowInput, ctx: AuditContext): AuditText {
  const n = TABLES[table];
  const before = obj(row.before);
  const after = obj(row.after);
  const cur = after ?? before ?? {};
  const changes = op === "update" && before && after ? diff(table, before, after, ctx) : [];
  const verb = op === "insert" ? "criou" : op === "delete" ? "removeu" : "alterou";
  const currency = str(cur.currency);
  const result = (sentence: string): AuditText => ({ category: n.category, sentence, changes });

  switch (table) {
    case "companies":
      if (op === "update") return result(`alterou os dados da empresa${nameOf(table, cur) ? ` ${nameOf(table, cur)}` : ""}${fieldList(changes)}`);
      break;
    case "employees": {
      const name = nameOf(table, cur);
      if (op === "update") {
        const st = changes.length === 1 && before && after && !same(before.status, after.status) ? str(after.status) : undefined;
        if (st === "terminated") return result(`registou a saída de ${name ?? "um colaborador"}`);
        if (st === "inactive") return result(`desactivou ${target(n, name)}`);
        if (st === "active") return result(`reactivou ${target(n, name)}`);
        return result(`alterou a ficha ${ofEmployee(name)}${fieldList(changes)}`);
      }
      break;
    }
    case "salary_agreements": {
      const emp = employeeName(cur.employee_id, ctx);
      if (op === "insert") return result(`alterou o salário base ${ofEmployee(emp)} para ${formatMzn(cur.amount, currency)}`);
      if (op === "delete") return result(`removeu um acordo salarial ${ofEmployee(emp)}`);
      const onlyEnd = changes.length === 1 && before && after && !same(before.effective_to, after.effective_to) && after.effective_to;
      if (onlyEnd) return result(`encerrou o acordo salarial ${ofEmployee(emp)} em ${formatDay(String(after.effective_to))}`);
      return result(`corrigiu o acordo salarial ${ofEmployee(emp)}${fieldList(changes)}`);
    }
    case "employee_components": {
      const emp = employeeName(cur.employee_id, ctx);
      const comp = isUuid(cur.component_id) ? ctx.names?.[cur.component_id] : undefined;
      const what = comp ? `a rubrica ${comp}` : "uma rubrica";
      if (op === "insert") return result(`atribuiu ${what} ${toEmployee(emp)} (${formatMzn(cur.amount, currency)})`);
      if (op === "delete") return result(`retirou ${what} ${ofEmployee(emp)}`);
      return result(`alterou ${what} ${ofEmployee(emp)}${fieldList(changes)}`);
    }
    case "holidays": {
      const name = nameOf(table, cur);
      const d = str(cur.date);
      return result(`${verb} ${target(n, name)}${d ? ` de ${formatDay(d)}` : ""}${op === "update" ? fieldList(changes) : ""}`);
    }
    case "shift_assignments": {
      const emp = employeeName(cur.employee_id, ctx);
      const sch = isUuid(cur.schedule_id) ? ctx.names?.[cur.schedule_id] : undefined;
      const what = sch ? `o horário ${sch}` : "um horário";
      const from = str(cur.valid_from);
      if (op === "insert") return result(`atribuiu ${what} ${toEmployee(emp)}${from ? ` a partir de ${formatDay(from)}` : ""}`);
      if (op === "delete") return result(`retirou ${what} ${ofEmployee(emp)}`);
      return result(`alterou o horário atribuído ${toEmployee(emp)}${fieldList(changes)}`);
    }
    case "subscriptions": {
      const plan = isUuid(cur.plan_id) ? ctx.names?.[cur.plan_id] : undefined;
      if (op === "insert") return result(`activou a subscrição${plan ? ` do plano ${plan}` : ""}`);
      if (op === "delete") return result("removeu a subscrição");
      return result(`alterou a subscrição${fieldList(changes)}`);
    }
  }
  const name = nameOf(table, cur);
  return result(`${verb} ${target(n, name)}${op === "update" ? fieldList(changes) : ""}`);
}

function periodOf(rel: AuditRelated | undefined): string | undefined {
  return rel?.year && rel?.month ? monthLabel(rel.year, rel.month) : undefined;
}

function describeExplicit(row: AuditRowInput, ctx: AuditContext): AuditText | null {
  const category = EXPLICIT[row.action];
  if (!category) return null;
  const before = obj(row.before) ?? {};
  const after = obj(row.after) ?? {};
  const rel = row.entity_id ? ctx.related?.[row.entity_id] : undefined;
  const emp = rel?.employeeId ? ctx.names?.[rel.employeeId] : undefined;
  const period = periodOf(rel);
  const ofPeriod = period ? ` de ${period}` : "";
  const reason = str(after.reason);
  const changes: AuditChange[] = [];
  const out = (sentence: string): AuditText => ({ category, sentence, changes });

  switch (row.action) {
    case "company.provisioned": {
      const owner = str(after.owner);
      if (owner) changes.push({ label: "Proprietário", before: "—", after: owner });
      return out(`criou a empresa ${str(after.name) ?? ""}`.trim());
    }
    case "company_request.rejected":
      if (reason) changes.push({ label: "Motivo", before: "—", after: reason });
      return out("recusou um pedido de abertura de conta");
    case "company.status_changed": {
      const s = str(after.status);
      return out(`mudou o estado da empresa para ${s ? lowerFirst(STATUS_COMPANY[s] ?? s) : "outro estado"}`);
    }
    case "subscription.plan_changed": {
      const p = str(after.plan);
      return out(p ? `mudou a empresa para o plano ${ctx.names?.[p] ?? p}` : "mudou o plano da empresa");
    }
    case "user.password_reset":
      return out("repôs a palavra-passe do proprietário");
    case "employee.access_set": {
      const name = row.entity_id ? ctx.names?.[row.entity_id] : undefined;
      const role = str(after.role);
      const login = str(after.login);
      if (login) changes.push({ label: "Utilizador", before: "—", after: login });
      if (role) changes.push({ label: "Perfil", before: "—", after: ROLE[role] ?? role });
      const pw = after.passwordChanged === true ? ", com nova palavra-passe" : "";
      return out(`definiu o acesso ${ofEmployee(name)}${role ? ` (${ROLE[role] ?? role}${pw})` : pw}`);
    }
    case "employee.access_removed": {
      const name = row.entity_id ? ctx.names?.[row.entity_id] : undefined;
      return out(`removeu o acesso ${ofEmployee(name)}`);
    }
    case "attendance.reviewed": {
      const s = str(after.status);
      const b = str(before.status);
      changes.push({ label: "Estado", before: b ? (EVENT_STATUS[b] ?? b) : "—", after: s ? (EVENT_STATUS[s] ?? s) : "—" });
      if (reason) changes.push({ label: "Fundamento", before: "—", after: reason });
      const verdict = s === "accepted" ? "aceite" : s === "rejected" ? "rejeitada" : undefined;
      return out(`reviu uma marcação ${ofEmployee(emp)}${verdict ? ` (${verdict})` : ""}`);
    }
    case "attendance.adjusted": {
      const label = (v: string | undefined) => (v ? (DAILY_STATUS_LABEL[v as keyof typeof DAILY_STATUS_LABEL] ?? v) : "—");
      const s = str(after.status);
      changes.push({ label: "Estado do dia", before: label(str(before.status)), after: label(s) });
      if (reason) changes.push({ label: "Motivo", before: "—", after: reason });
      const day = rel?.date ? ` de ${formatDay(rel.date)}` : "";
      return out(`corrigiu o dia${day} ${ofEmployee(emp)}${s ? ` (${lowerFirst(label(s))})` : ""}`);
    }
    case "absence.created": {
      const t = str(after.type);
      const from = str(after.startDate);
      const to = str(after.endDate);
      const when = from ? (to && to !== from ? ` de ${formatDay(from)} a ${formatDay(to)}` : ` para ${formatDay(from)}`) : "";
      return out(`submeteu uma justificação${t ? ` por ${ABSENCE_TYPE[t] ?? t}` : ""}${when}`);
    }
    case "absence.approved":
    case "absence.rejected":
    case "absence.step_approved": {
      if (reason) changes.push({ label: "Fundamento", before: "—", after: reason });
      const role = str(after.role);
      if (row.action === "absence.step_approved") {
        return out(`validou a justificação ${ofEmployee(emp)}${role ? ` (etapa ${role === "supervisor" ? "do supervisor" : `de ${lowerFirst(ROLE[role] ?? role)}`})` : ""}`);
      }
      return out(`${row.action === "absence.approved" ? "aprovou" : "recusou"} a justificação ${ofEmployee(emp)}`);
    }
    case "payroll.attendance_closed":
      return out(`fechou a assiduidade${ofPeriod || " de um período"}`);
    case "payroll.attendance_reopened":
      return out(`reabriu a assiduidade${ofPeriod || " de um período"}`);
    case "payroll.run_prepared": {
      const v = str(after.version);
      const totals = obj(after.totals);
      if (totals) {
        if (totals.gross !== undefined) changes.push({ label: "Total bruto", before: "—", after: formatMzn(totals.gross) });
        if (totals.net !== undefined) changes.push({ label: "Total líquido", before: "—", after: formatMzn(totals.net) });
        const count = totals.employees ?? totals.count;
        if (typeof count === "number") changes.push({ label: "Colaboradores", before: "—", after: String(count) });
      }
      return out(`preparou o processamento salarial${ofPeriod}${v && v !== "1" ? ` (versão ${v})` : ""}`);
    }
    case "payroll.run_approved": {
      const v = str(after.version);
      return out(`aprovou o processamento salarial${ofPeriod}${v && v !== "1" ? ` (versão ${v})` : ""}`);
    }
    case "payroll.period_closed":
      return out(`encerrou o período salarial${ofPeriod}`);
    case "payroll.payslips_issued": {
      const n = typeof after.issued === "number" ? after.issued : undefined;
      const what = n === undefined ? "os recibos de vencimento" : n === 1 ? "1 recibo de vencimento" : `${n} recibos de vencimento`;
      return out(`emitiu ${what}${ofPeriod}`);
    }
    case "payroll.payment_registered": {
      const m = str(after.method);
      return out(`registou um pagamento de ${formatMzn(after.amount)} ${toEmployee(emp)}${m ? ` (${PAYMENT_METHOD[m] ?? m})` : ""}`);
    }
    case "report.exported": {
      const r = row.entity_id ?? "";
      const month = str(after.month);
      const ym = month ? /^(\d{4})-(\d{2})/.exec(month) : null;
      const when = ym ? ` de ${monthLabel(Number(ym[1]), Number(ym[2]))}` : "";
      if (r === "assiduidade") return { category: "Assiduidade", sentence: `exportou o relatório de assiduidade${when}`, changes };
      if (r === "assiduidade_colaborador") {
        const who = employeeName(after.employee, ctx);
        return { category: "Assiduidade", sentence: `exportou a assiduidade ${ofEmployee(who)}${when}`, changes };
      }
      if (r === "colaboradores") return out(`exportou a lista de colaboradores${after.withSalary === true ? " com salários" : ""}`);
      return out(`exportou um relatório${r ? ` (${r})` : ""}`);
    }
    case "ai.owner_notified": {
      const subject = str(after.subject);
      return out(`pediu ao assistente para avisar o responsável${subject ? `: ${subject}` : ""}`);
    }
    case "qr.created":
    case "qr.regenerated": {
      const st = str(after.station);
      const what = st ? `da estação ${st}` : "de uma estação";
      return out(row.action === "qr.created" ? `criou o QR Code fixo ${what}` : `gerou um novo QR Code fixo ${what}`);
    }
    case "qr.window_changed": {
      const st = str(after.station);
      const win = (o: Json) => (str(o.start) && str(o.end) ? `${str(o.start)} às ${str(o.end)}` : "Sempre");
      changes.push({ label: "Horas do QR", before: win(before), after: win(after) });
      return out(`alterou as horas do QR Code ${st ? `da estação ${st}` : "de uma estação"}`);
    }
    case "clock_link.created":
    case "clock_link.updated":
    case "clock_link.deleted": {
      const o = row.action === "clock_link.deleted" ? before : after;
      const d = str(o.date);
      const hours = str(o.start) && str(o.end) ? ` das ${str(o.start)} às ${str(o.end)}` : "";
      const when = d ? ` para ${formatDay(d)}${hours}` : "";
      const note = str(o.note);
      if (note) changes.push({ label: "Nota", before: "—", after: note });
      const verb = row.action === "clock_link.created" ? "criou" : row.action === "clock_link.updated" ? "alterou" : "removeu";
      return out(`${verb} uma marcação por link${when}`);
    }
    case "clock_link.shown":
    case "clock_link.hidden": {
      const d = str(after.date);
      const when = d ? ` de ${formatDay(d)}` : "";
      return out(
        row.action === "clock_link.shown"
          ? `mostrou aos colaboradores o link de reserva${when}`
          : `deixou de mostrar aos colaboradores o link de reserva${when}`,
      );
    }
    case "employee.modules_set": {
      const name = row.entity_id ? ctx.names?.[row.entity_id] : undefined;
      const mods = Array.isArray(after.modules) ? (after.modules as string[]) : [];
      return out(`mudou as funções do gerente ${ofEmployee(name)}${mods.length ? ` (${mods.join(", ")})` : " (só estoque)"}`);
    }
    case "stock.item_create":
      return out(`adicionou ao estoque o material ${str(after.name) ?? ""}`.trim());
    case "stock.item_update":
      return out(`alterou o material ${str(after.name) ?? ""} do estoque`.replace("  ", " "));
    case "stock.item_archive":
      return out(`arquivou o material ${str(after.name) ?? ""} do estoque`.replace("  ", " "));
    case "stock.item_restore":
      return out(`repôs o material ${str(after.name) ?? ""} no estoque`.replace("  ", " "));
    case "vehicle.create":
      return out(`registou a viatura ${str(after.plate) ?? ""}${str(after.name) ? ` (${str(after.name)})` : ""}`);
    case "vehicle.update":
      return out(`alterou os dados da viatura ${str(after.plate) ?? ""}`.trim());
    case "vehicle.visit_open":
      return out(`abriu uma nova entrada da viatura ${str(after.plate) ?? ""}`.trim());
    case "vehicle.visit_save":
      return out(str(after.status) === "concluida" ? "concluiu o trabalho numa viatura" : "registou o trabalho feito numa viatura");
    case "vehicle.visit_delete":
      return out("apagou uma entrada de uma viatura");
  }
  return null;
}

const ENTITY_NOUN: Record<string, string> = {
  company: "na empresa",
  company_request: "num pedido de conta",
  user: "num utilizador",
  employee: "num colaborador",
  attendance_event: "numa marcação",
  attendance_daily: "na assiduidade",
  absence_request: "numa justificação",
  payroll_period: "num período salarial",
  payroll_run: "num processamento salarial",
  salary_payment: "num pagamento",
  report: "num relatório",
  attendance_station: "numa estação",
  clock_link: "numa marcação por link",
};

function categoryGuess(action: string, entity: string): AuditCategory {
  const s = `${action} ${entity}`;
  if (/payroll|salary|payslip|payment/.test(s)) return "Salários";
  if (/absence/.test(s)) return "Justificações";
  if (/attendance/.test(s)) return "Assiduidade";
  if (/user|access|password|login/.test(s)) return "Acessos";
  if (/employee/.test(s)) return "Pessoas";
  if (/subscription|plan|company_request|provision/.test(s)) return "Plataforma";
  return "Configuração";
}

/** Descreve uma linha de auditoria (sem o nome de quem fez, que a página mostra em destaque). */
export function describeAudit(row: AuditRowInput, ctx: AuditContext = {}): AuditText {
  const [table, op] = splitAction(row.action);
  if (TABLES[table] && (TRIGGER_OPS as readonly string[]).includes(op)) return describeTrigger(table, op, row, ctx);
  const explicit = describeExplicit(row, ctx);
  if (explicit) return explicit;
  // Acção desconhecida: frase genérica, nunca o código.
  const verb = /(insert|create|provision|add)/.test(op) ? "criou um registo" : /(delete|remove)/.test(op) ? "removeu um registo" : /(update|change|set)/.test(op) ? "fez uma alteração" : "registou uma acção";
  const where = ENTITY_NOUN[row.entity] ?? (TABLES[row.entity] ? `em ${TABLES[row.entity].def === "a" ? "uma" : "um"} ${TABLES[row.entity].noun}` : "");
  return { category: categoryGuess(row.action, row.entity), sentence: `${verb}${where ? ` ${where}` : ""}`, changes: [] };
}

/** Nome a mostrar para quem fez a acção. */
export function actorLabel(name: string | null | undefined, actorId: string | null | undefined): string {
  return name?.trim() || (actorId ? "Utilizador removido" : "Sistema");
}

/** Ids referidos numa linha (colaboradores, rubricas, horários, locais, planos), para a página procurar os nomes. */
export function referencedIds(row: AuditRowInput): string[] {
  const out = new Set<string>();
  for (const r of [obj(row.before), obj(row.after)]) {
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) if (k !== "id" && k !== "company_id" && k.endsWith("_id") && isUuid(v)) out.add(v);
  }
  const emp = obj(row.after)?.employee;
  if (row.action === "report.exported" && isUuid(emp)) out.add(emp);
  if ((row.entity === "employee" || row.entity === "employees") && isUuid(row.entity_id)) out.add(row.entity_id);
  return Array.from(out);
}
