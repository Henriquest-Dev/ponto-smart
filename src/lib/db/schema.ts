/**
 * Esquema PostgreSQL + PostGIS do PontoSmart.
 *
 * Convenções:
 *  - Chaves primárias UUID (gen_random_uuid()).
 *  - Todas as tabelas de dados de cliente têm `company_id` (isolamento multi-tenant).
 *  - Valores monetários em NUMERIC(14,2); instantes em timestamptz (UTC).
 *  - Geometrias em geography(…, 4326) para distâncias em metros.
 */
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Tipos auxiliares                                                    */
/* ------------------------------------------------------------------ */

const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Point,4326)",
});
const geographyPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Polygon,4326)",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "string" });
const companyRef = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" });

/* ------------------------------------------------------------------ */
/* Enumerações                                                         */
/* ------------------------------------------------------------------ */

export const companyStatus = pgEnum("company_status", ["trial", "active", "suspended", "cancelled"]);
export const userStatus = pgEnum("user_status", ["active", "invited", "disabled"]);
export const employeeStatus = pgEnum("employee_status", ["active", "inactive", "terminated"]);
export const contractType = pgEnum("contract_type", [
  "indeterminado",
  "determinado",
  "estagio",
  "prestacao_servicos",
]);
export const qrMode = pgEnum("qr_mode", ["dynamic", "static"]);
export const attendanceEventType = pgEnum("attendance_event_type", ["in", "out", "break_start", "break_end"]);
export const attendanceEventStatus = pgEnum("attendance_event_status", ["accepted", "review", "rejected"]);
export const geofenceResult = pgEnum("geofence_result", ["inside", "outside", "inconclusive", "unavailable"]);
export const deviceResult = pgEnum("device_result", ["trusted", "unknown", "revoked", "not_required"]);
export const dailyStatus = pgEnum("daily_status", [
  "on_time",
  "late",
  "incomplete",
  "absent_pending",
  "justified",
  "unjustified",
  "review",
  "holiday",
  "day_off",
  "present",
]);
export const absenceStatus = pgEnum("absence_status", ["pending", "approved", "rejected", "cancelled"]);
export const approvalDecision = pgEnum("approval_decision", ["pending", "approved", "rejected", "skipped"]);
export const payrollPeriodStatus = pgEnum("payroll_period_status", [
  "open",
  "attendance_closed",
  "approved",
  "closed",
]);
export const payrollRunStatus = pgEnum("payroll_run_status", ["draft", "approved", "superseded"]);
export const componentNature = pgEnum("component_nature", ["earning", "deduction"]);
export const componentCalc = pgEnum("component_calc", ["fixed", "percent_base", "per_hour"]);
export const subscriptionStatus = pgEnum("subscription_status", ["trialing", "active", "past_due", "cancelled"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "paid", "void"]);
export const aiApprovalStatus = pgEnum("ai_approval_status", ["not_required", "pending", "approved", "rejected"]);

/* ------------------------------------------------------------------ */
/* Identidade e organização                                            */
/* ------------------------------------------------------------------ */

export type CompanySettings = {
  /** Política de dispositivo de confiança na marcação. */
  devicePolicy: "off" | "warn" | "require";
  /** Fluxo de aprovação de justificações. */
  absenceFlow: "single" | "supervisor_then_hr";
  /** Exigir MFA a administradores, RH e financeiro. */
  requireMfaForAdmins: boolean;
  /** Janela (minutos) para considerar uma marcação duplicada. */
  duplicateWindowMinutes: number;
  /** Divisor para valor diário do salário base (pressuposto: 30). */
  payrollDailyDivisor: number;
};

export const defaultCompanySettings: CompanySettings = {
  devicePolicy: "warn",
  absenceFlow: "supervisor_then_hr",
  requireMfaForAdmins: false,
  duplicateWindowMinutes: 2,
  payrollDailyDivisor: 30,
};

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  nuit: text("nuit"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  timezone: text("timezone").notNull().default("Africa/Maputo"),
  currency: text("currency").notNull().default("MZN"),
  status: companyStatus("status").notNull().default("trial"),
  settings: jsonb("settings").$type<CompanySettings>().notNull().default(defaultCompanySettings),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    companyId: companyRef(),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    createdAt: createdAt(),
  },
  (t) => [index("branches_company_idx").on(t.companyId)],
);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: userStatus("status").notNull().default("active"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  /** Segredo TOTP cifrado (AES-GCM). */
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const departments = pgTable(
  "departments",
  {
    id: id(),
    companyId: companyRef(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** Supervisor responsável (vê apenas a equipa destes departamentos). */
    managerUserId: uuid("manager_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("departments_company_idx").on(t.companyId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    mfaPending: boolean("mfa_pending").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const roles = pgTable("roles", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
});

export const permissions = pgTable("permissions", {
  id: id(),
  code: text("code").notNull().unique(),
  module: text("module").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_company_uq").on(t.userId, t.companyId),
    index("memberships_company_idx").on(t.companyId),
  ],
);

/* ------------------------------------------------------------------ */
/* Colaboradores, contratos e horários                                 */
/* ------------------------------------------------------------------ */

export const employees = pgTable(
  "employees",
  {
    id: id(),
    companyId: companyRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    employeeCode: text("employee_code").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    hireDate: date("hire_date"),
    status: employeeStatus("status").notNull().default("active"),
    nuit: text("nuit"),
    bankAccount: text("bank_account"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("employees_company_code_uq").on(t.companyId, t.employeeCode),
    uniqueIndex("employees_user_uq").on(t.companyId, t.userId),
    index("employees_department_idx").on(t.departmentId),
  ],
);

export const employmentContracts = pgTable(
  "employment_contracts",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: contractType("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    weeklyHours: integer("weekly_hours").notNull().default(40),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("contracts_employee_idx").on(t.employeeId)],
);

export const salaryAgreements = pgTable(
  "salary_agreements",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("MZN"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("salary_employee_idx").on(t.employeeId, t.effectiveFrom)],
);

export const workSchedules = pgTable(
  "work_schedules",
  {
    id: id(),
    companyId: companyRef(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Africa/Maputo"),
    toleranceMinutes: integer("tolerance_minutes").notNull().default(10),
    createdAt: createdAt(),
  },
  (t) => [index("schedules_company_idx").on(t.companyId)],
);

export const scheduleRules = pgTable(
  "schedule_rules",
  {
    id: id(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => workSchedules.id, { onDelete: "cascade" }),
    /** Dia ISO: 1 = segunda … 7 = domingo. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(60),
  },
  (t) => [uniqueIndex("schedule_rules_day_uq").on(t.scheduleId, t.weekday)],
);

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => workSchedules.id, { onDelete: "cascade" }),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
  },
  (t) => [index("shift_employee_idx").on(t.employeeId, t.validFrom)],
);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    companyId: companyRef(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    recurring: boolean("recurring").notNull().default(true),
  },
  (t) => [uniqueIndex("holidays_company_date_uq").on(t.companyId, t.date)],
);

/* ------------------------------------------------------------------ */
/* Locais, estações QR e dispositivos                                  */
/* ------------------------------------------------------------------ */

export const workLocations = pgTable(
  "work_locations",
  {
    id: id(),
    companyId: companyRef(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    centerLat: numeric("center_lat", { precision: 9, scale: 6, mode: "number" }).notNull(),
    centerLng: numeric("center_lng", { precision: 9, scale: 6, mode: "number" }).notNull(),
    radiusM: integer("radius_m").notNull().default(60),
    center: geographyPoint("center").notNull(),
    /** Polígono opcional; se existir tem prioridade sobre o raio. */
    geom: geographyPolygon("geom"),
    /** Precisão GPS máxima aceite (metros) antes de ficar inconclusivo. */
    maxAccuracyM: integer("max_accuracy_m").notNull().default(80),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index("locations_company_idx").on(t.companyId),
    index("locations_center_gix").using("gist", t.center),
  ],
);

export const attendanceStations = pgTable(
  "attendance_stations",
  {
    id: id(),
    companyId: companyRef(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => workLocations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    qrMode: qrMode("qr_mode").notNull().default("dynamic"),
    /** Hash do token do QR fixo (apenas quando qr_mode = static). */
    staticTokenHash: text("static_token_hash"),
    rotationSeconds: integer("rotation_seconds").notNull().default(30),
    active: boolean("active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("stations_company_idx").on(t.companyId)],
);

export const qrChallenges = pgTable(
  "qr_challenges",
  {
    id: id(),
    companyId: companyRef(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => attendanceStations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("qr_challenges_station_idx").on(t.stationId, t.expiresAt)],
);

export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Hash do identificador gerado no dispositivo (não é prova infalível de hardware). */
    credentialId: text("credential_id").notNull(),
    label: text("label").notNull(),
    userAgent: text("user_agent"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("trusted_devices_uq").on(t.employeeId, t.credentialId)],
);

/* ------------------------------------------------------------------ */
/* Presença                                                            */
/* ------------------------------------------------------------------ */

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    stationId: uuid("station_id").references(() => attendanceStations.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => workLocations.id, { onDelete: "set null" }),
    type: attendanceEventType("type").notNull(),
    /** Hora determinada pelo servidor. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** Dia de trabalho a que pertence (turnos que atravessam a meia-noite). */
    workDate: date("work_date").notNull(),
    status: attendanceEventStatus("status").notNull(),
    source: text("source").notNull().default("qr"),
    idempotencyKey: text("idempotency_key").notNull(),
    deviceId: uuid("device_id").references(() => trustedDevices.id, { onDelete: "set null" }),
    reason: text("reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("attendance_events_idem_uq").on(t.companyId, t.employeeId, t.idempotencyKey),
    index("attendance_events_emp_idx").on(t.companyId, t.employeeId, t.occurredAt),
    index("attendance_events_status_idx").on(t.companyId, t.status),
  ],
);

export const attendanceValidations = pgTable(
  "attendance_validations",
  {
    id: id(),
    companyId: companyRef(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => attendanceEvents.id, { onDelete: "cascade" }),
    qrMode: qrMode("qr_mode"),
    tokenValid: boolean("token_valid").notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    accuracyM: numeric("accuracy_m", { precision: 8, scale: 1, mode: "number" }),
    distanceM: numeric("distance_m", { precision: 10, scale: 1, mode: "number" }),
    geofenceResult: geofenceResult("geofence_result").notNull(),
    deviceResult: deviceResult("device_result").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("attendance_validations_event_idx").on(t.eventId)],
);

export const attendanceDaily = pgTable(
  "attendance_daily",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    scheduleId: uuid("schedule_id").references(() => workSchedules.id, { onDelete: "set null" }),
    expectedStart: timestamp("expected_start", { withTimezone: true }),
    expectedEnd: timestamp("expected_end", { withTimezone: true }),
    firstIn: timestamp("first_in", { withTimezone: true }),
    lastOut: timestamp("last_out", { withTimezone: true }),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    breakMinutes: integer("break_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    status: dailyStatus("status").notNull(),
    absenceRequestId: uuid("absence_request_id"),
    locked: boolean("locked").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("attendance_daily_emp_date_uq").on(t.employeeId, t.workDate),
    index("attendance_daily_company_date_idx").on(t.companyId, t.workDate),
  ],
);

export const attendanceAdjustments = pgTable(
  "attendance_adjustments",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    previous: jsonb("previous").$type<Record<string, unknown>>(),
    next: jsonb("next").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("attendance_adjustments_emp_idx").on(t.companyId, t.employeeId, t.workDate)],
);

/* ------------------------------------------------------------------ */
/* Justificações e aprovações                                          */
/* ------------------------------------------------------------------ */

export const absenceRequests = pgTable(
  "absence_requests",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    type: text("type").notNull(),
    reason: text("reason").notNull(),
    status: absenceStatus("status").notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("absence_requests_company_idx").on(t.companyId, t.status)],
);

export const absenceDocuments = pgTable("absence_documents", {
  id: id(),
  companyId: companyRef(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => absenceRequests.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: createdAt(),
});

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: id(),
    companyId: companyRef(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => absenceRequests.id, { onDelete: "cascade" }),
    stepOrder: smallint("step_order").notNull(),
    /** Papel que decide este passo: supervisor | hr. */
    approverRole: text("approver_role").notNull(),
    approverId: uuid("approver_id").references(() => users.id),
    decision: approvalDecision("decision").notNull().default("pending"),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("approval_steps_order_uq").on(t.requestId, t.stepOrder)],
);

/* ------------------------------------------------------------------ */
/* Processamento salarial                                              */
/* ------------------------------------------------------------------ */

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: id(),
    companyId: companyRef(),
    year: smallint("year").notNull(),
    month: smallint("month").notNull(),
    status: payrollPeriodStatus("status").notNull().default("open"),
    attendanceClosedAt: timestamp("attendance_closed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_periods_uq").on(t.companyId, t.year, t.month)],
);

export const payrollComponents = pgTable(
  "payroll_components",
  {
    id: id(),
    companyId: companyRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nature: componentNature("nature").notNull(),
    calcType: componentCalc("calc_type").notNull(),
    /** Valor fixo por defeito, percentagem (0–100) ou multiplicador horário. */
    rate: numeric("rate", { precision: 12, scale: 4, mode: "string" }),
    /** Entra na base das retenções configuradas. */
    taxable: boolean("taxable").notNull().default(true),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("payroll_components_code_uq").on(t.companyId, t.code, t.effectiveFrom)],
);

/** Rubricas atribuídas a um colaborador (subsídios, adiantamentos, descontos autorizados). */
export const employeeComponents = pgTable(
  "employee_components",
  {
    id: id(),
    companyId: companyRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => payrollComponents.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    note: text("note"),
  },
  (t) => [index("employee_components_emp_idx").on(t.employeeId)],
);

export type RuleParams = {
  /** Natureza: contribuição do trabalhador, imposto sobre o rendimento ou encargo da entidade patronal. */
  kind: "employee_contribution" | "income_tax" | "employer_contribution";
  /** Percentagem sobre a base (ex.: contribuição). */
  ratePercent?: number | null;
  /** Escalões progressivos: até `upTo` (null = sem limite), taxa em %, parcela a abater. */
  brackets?: { upTo: number | null; ratePercent: number; deduction: number }[];
  note?: string;
};

/** Regras legais/fiscais versionadas. Só são aplicadas quando `validated = true`. */
export const payrollRuleVersions = pgTable(
  "payroll_rule_versions",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    jurisdiction: text("jurisdiction").notNull().default("MZ"),
    ruleCode: text("rule_code").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    params: jsonb("params").$type<RuleParams>().notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    validated: boolean("validated").notNull().default(false),
    validatedBy: text("validated_by"),
    sourceReference: text("source_reference"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_rule_versions_uq").on(t.companyId, t.ruleCode, t.version)],
);

export type PayrollWarning = { employeeId?: string; code: string; message: string };

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    companyId: companyRef(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: payrollRunStatus("status").notNull().default("draft"),
    engineVersion: text("engine_version").notNull(),
    inputHash: text("input_hash").notNull(),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    totals: jsonb("totals").$type<{ gross: string; deductions: string; net: string; employees: number }>().notNull(),
    warnings: jsonb("warnings").$type<PayrollWarning[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("payroll_runs_version_uq").on(t.periodId, t.version)],
);

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: id(),
    companyId: companyRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    gross: money("gross").notNull(),
    deductions: money("deductions").notNull(),
    net: money("net").notNull(),
    currency: text("currency").notNull().default("MZN"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [uniqueIndex("payroll_items_run_emp_uq").on(t.runId, t.employeeId)],
);

export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: id(),
    companyId: companyRef(),
    payrollItemId: uuid("payroll_item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    nature: componentNature("nature").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 4, mode: "string" }),
    rate: numeric("rate", { precision: 14, scale: 4, mode: "string" }),
    amount: money("amount").notNull(),
    origin: text("origin").notNull(),
    ruleVersionId: uuid("rule_version_id").references(() => payrollRuleVersions.id),
    sort: smallint("sort").notNull().default(0),
  },
  (t) => [index("payroll_lines_item_idx").on(t.payrollItemId)],
);

export const payslips = pgTable("payslips", {
  id: id(),
  companyId: companyRef(),
  payrollItemId: uuid("payroll_item_id")
    .notNull()
    .unique()
    .references(() => payrollItems.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  runId: uuid("run_id")
    .notNull()
    .references(() => payrollRuns.id, { onDelete: "cascade" }),
  reference: text("reference").notNull().unique(),
  documentKey: text("document_key"),
  issuedBy: uuid("issued_by")
    .notNull()
    .references(() => users.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payslipAcknowledgements = pgTable("payslip_acknowledgements", {
  id: id(),
  companyId: companyRef(),
  payslipId: uuid("payslip_id")
    .notNull()
    .unique()
    .references(() => payslips.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
});

export const salaryPayments = pgTable(
  "salary_payments",
  {
    id: id(),
    companyId: companyRef(),
    payrollItemId: uuid("payroll_item_id")
      .notNull()
      .references(() => payrollItems.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    paidAt: date("paid_at").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    registeredBy: uuid("registered_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("salary_payments_item_idx").on(t.payrollItemId)],
);

/* ------------------------------------------------------------------ */
/* Auditoria, notificações, IA                                         */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_company_idx").on(t.companyId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    companyId: companyRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export type AiMessage = { role: "user" | "assistant"; content: string; at: string };

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    companyId: companyRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    messages: jsonb("messages").$type<AiMessage[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.companyId, t.userId)],
);

export const aiToolExecutions = pgTable("ai_tool_executions", {
  id: id(),
  companyId: companyRef(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<unknown>(),
  approvalStatus: aiApprovalStatus("approval_status").notNull().default("not_required"),
  approvedBy: uuid("approved_by").references(() => users.id),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* SaaS: planos, subscrições e facturação                              */
/* ------------------------------------------------------------------ */

export const subscriptionPlans = pgTable("subscription_plans", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  priceMonthly: money("price_monthly").notNull(),
  currency: text("currency").notNull().default("MZN"),
  maxEmployees: integer("max_employees").notNull(),
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    companyId: companyRef(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: subscriptionStatus("status").notNull().default("trialing"),
    billingCycle: text("billing_cycle").notNull().default("monthly"),
    currentPeriodStart: date("current_period_start").notNull(),
    currentPeriodEnd: date("current_period_end").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("subscriptions_company_idx").on(t.companyId)],
);

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: id(),
    companyId: companyRef(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    number: text("number").notNull().unique(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("MZN"),
    status: invoiceStatus("status").notNull().default("issued"),
    issuedAt: date("issued_at").notNull(),
    dueAt: date("due_at").notNull(),
    paidAt: date("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [index("billing_invoices_company_idx").on(t.companyId)],
);

/* ------------------------------------------------------------------ */
/* Infra                                                               */
/* ------------------------------------------------------------------ */

/** Contadores de rate limiting partilhados entre instâncias serverless. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

