-- =====================================================================
-- PontoSmart — esquema completo para o Supabase (SQL Editor)
-- Gerado a partir das migrações em drizzle/. Executar UMA vez numa base vazia.
-- Inclui: extensões (PostGIS), tabelas, índices, triggers de integridade,
-- bloqueio da API REST do Supabase (RLS) e dados de referência
-- (papéis, permissões, planos e regras salariais por validar).
-- =====================================================================

BEGIN;
-- ---------------------------------------------------------------------
-- drizzle/0000_extensions.sql
-- ---------------------------------------------------------------------
-- Extensões necessárias: UUID aleatórios e PostGIS (geofence).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- drizzle/0001_schema.sql
-- ---------------------------------------------------------------------
CREATE TYPE "public"."absence_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE "public"."ai_approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');
CREATE TYPE "public"."approval_decision" AS ENUM('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE "public"."attendance_event_status" AS ENUM('accepted', 'review', 'rejected');
CREATE TYPE "public"."attendance_event_type" AS ENUM('in', 'out', 'break_start', 'break_end');
CREATE TYPE "public"."company_status" AS ENUM('trial', 'active', 'suspended', 'cancelled');
CREATE TYPE "public"."component_calc" AS ENUM('fixed', 'percent_base', 'per_hour');
CREATE TYPE "public"."component_nature" AS ENUM('earning', 'deduction');
CREATE TYPE "public"."contract_type" AS ENUM('indeterminado', 'determinado', 'estagio', 'prestacao_servicos');
CREATE TYPE "public"."daily_status" AS ENUM('on_time', 'late', 'incomplete', 'absent_pending', 'justified', 'unjustified', 'review', 'holiday', 'day_off', 'present');
CREATE TYPE "public"."device_result" AS ENUM('trusted', 'unknown', 'revoked', 'not_required');
CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive', 'terminated');
CREATE TYPE "public"."geofence_result" AS ENUM('inside', 'outside', 'inconclusive', 'unavailable');
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');
CREATE TYPE "public"."payroll_period_status" AS ENUM('open', 'attendance_closed', 'approved', 'closed');
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'approved', 'superseded');
CREATE TYPE "public"."qr_mode" AS ENUM('dynamic', 'static');
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled');
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');
CREATE TABLE "absence_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "absence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"status" "absence_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"approval_status" "ai_approval_status" DEFAULT 'not_required' NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"step_order" smallint NOT NULL,
	"approver_role" text NOT NULL,
	"approver_id" uuid,
	"decision" "approval_decision" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone
);

CREATE TABLE "attendance_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"author_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"previous" jsonb,
	"next" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attendance_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"schedule_id" uuid,
	"expected_start" timestamp with time zone,
	"expected_end" timestamp with time zone,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"status" "daily_status" NOT NULL,
	"absence_request_id" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"station_id" uuid,
	"location_id" uuid,
	"type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"work_date" date NOT NULL,
	"status" "attendance_event_status" NOT NULL,
	"source" text DEFAULT 'qr' NOT NULL,
	"idempotency_key" text NOT NULL,
	"device_id" uuid,
	"reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attendance_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qr_mode" "qr_mode" DEFAULT 'dynamic' NOT NULL,
	"static_token_hash" text,
	"rotation_seconds" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attendance_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"qr_mode" "qr_mode",
	"token_valid" boolean NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy_m" numeric(8, 1),
	"distance_m" numeric(10, 1),
	"geofence_result" "geofence_result" NOT NULL,
	"device_result" "device_result" NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"number" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MZN' NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"issued_at" date NOT NULL,
	"due_at" date NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_number_unique" UNIQUE("number")
);

CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"nuit" text,
	"email" text,
	"phone" text,
	"address" text,
	"timezone" text DEFAULT 'Africa/Maputo' NOT NULL,
	"currency" text DEFAULT 'MZN' NOT NULL,
	"status" "company_status" DEFAULT 'trial' NOT NULL,
	"settings" jsonb DEFAULT '{"devicePolicy":"warn","absenceFlow":"supervisor_then_hr","requireMfaForAdmins":false,"duplicateWindowMinutes":2,"payrollDailyDivisor":30}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "employee_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"note" text
);

CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_code" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_title" text,
	"department_id" uuid,
	"branch_id" uuid,
	"hire_date" date,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"nuit" text,
	"bank_account" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "employment_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "contract_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"weekly_hours" integer DEFAULT 40 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"recurring" boolean DEFAULT true NOT NULL
);

CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"nature" "component_nature" NOT NULL,
	"calc_type" "component_calc" NOT NULL,
	"rate" numeric(12, 4),
	"taxable" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL
);

CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"deductions" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MZN' NOT NULL,
	"snapshot" jsonb NOT NULL
);

CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"nature" "component_nature" NOT NULL,
	"quantity" numeric(12, 4),
	"rate" numeric(14, 4),
	"amount" numeric(14, 2) NOT NULL,
	"origin" text NOT NULL,
	"rule_version_id" uuid,
	"sort" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" "payroll_period_status" DEFAULT 'open' NOT NULL,
	"attendance_closed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"jurisdiction" text DEFAULT 'MZ' NOT NULL,
	"rule_code" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"validated" boolean DEFAULT false NOT NULL,
	"validated_by" text,
	"source_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"engine_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"prepared_by" uuid NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"totals" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE "payslip_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	CONSTRAINT "payslip_acknowledgements_payslip_id_unique" UNIQUE("payslip_id")
);

CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"document_key" text,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_payroll_item_id_unique" UNIQUE("payroll_item_id"),
	CONSTRAINT "payslips_reference_unique" UNIQUE("reference")
);

CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);

CREATE TABLE "qr_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "qr_challenges_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);

CREATE TABLE "salary_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MZN' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "salary_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_at" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"registered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "schedule_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL
);

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"company_id" uuid,
	"mfa_pending" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);

CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_monthly" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MZN' NOT NULL,
	"max_employees" integer NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_code_unique" UNIQUE("code")
);

CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"current_period_start" date NOT NULL,
	"current_period_end" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"label" text NOT NULL,
	"user_agent" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "work_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"center_lat" numeric(9, 6) NOT NULL,
	"center_lng" numeric(9, 6) NOT NULL,
	"radius_m" integer DEFAULT 60 NOT NULL,
	"center" geography(Point,4326) NOT NULL,
	"geom" geography(Polygon,4326),
	"max_accuracy_m" integer DEFAULT 80 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Maputo' NOT NULL,
	"tolerance_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "absence_documents" ADD CONSTRAINT "absence_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence_documents" ADD CONSTRAINT "absence_documents_request_id_absence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."absence_requests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence_documents" ADD CONSTRAINT "absence_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_absence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."absence_requests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_daily" ADD CONSTRAINT "attendance_daily_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_daily" ADD CONSTRAINT "attendance_daily_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_daily" ADD CONSTRAINT "attendance_daily_schedule_id_work_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_station_id_attendance_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."attendance_stations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_device_id_trusted_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."trusted_devices"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_stations" ADD CONSTRAINT "attendance_stations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_stations" ADD CONSTRAINT "attendance_stations_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_validations" ADD CONSTRAINT "attendance_validations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_validations" ADD CONSTRAINT "attendance_validations_event_id_attendance_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attendance_events"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employee_components" ADD CONSTRAINT "employee_components_component_id_payroll_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."payroll_components"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_rule_version_id_payroll_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."payroll_rule_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_rule_versions" ADD CONSTRAINT "payroll_rule_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payslip_acknowledgements" ADD CONSTRAINT "payslip_acknowledgements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslip_acknowledgements" ADD CONSTRAINT "payslip_acknowledgements_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslip_acknowledgements" ADD CONSTRAINT "payslip_acknowledgements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "qr_challenges" ADD CONSTRAINT "qr_challenges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "qr_challenges" ADD CONSTRAINT "qr_challenges_station_id_attendance_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."attendance_stations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "salary_agreements" ADD CONSTRAINT "salary_agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "salary_agreements" ADD CONSTRAINT "salary_agreements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "salary_agreements" ADD CONSTRAINT "salary_agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_schedule_id_work_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_schedule_id_work_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "work_locations" ADD CONSTRAINT "work_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "work_locations" ADD CONSTRAINT "work_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "absence_requests_company_idx" ON "absence_requests" USING btree ("company_id","status");
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("company_id","user_id");
CREATE UNIQUE INDEX "approval_steps_order_uq" ON "approval_steps" USING btree ("request_id","step_order");
CREATE INDEX "attendance_adjustments_emp_idx" ON "attendance_adjustments" USING btree ("company_id","employee_id","work_date");
CREATE UNIQUE INDEX "attendance_daily_emp_date_uq" ON "attendance_daily" USING btree ("employee_id","work_date");
CREATE INDEX "attendance_daily_company_date_idx" ON "attendance_daily" USING btree ("company_id","work_date");
CREATE UNIQUE INDEX "attendance_events_idem_uq" ON "attendance_events" USING btree ("company_id","employee_id","idempotency_key");
CREATE INDEX "attendance_events_emp_idx" ON "attendance_events" USING btree ("company_id","employee_id","occurred_at");
CREATE INDEX "attendance_events_status_idx" ON "attendance_events" USING btree ("company_id","status");
CREATE INDEX "stations_company_idx" ON "attendance_stations" USING btree ("company_id");
CREATE INDEX "attendance_validations_event_idx" ON "attendance_validations" USING btree ("event_id");
CREATE INDEX "audit_logs_company_idx" ON "audit_logs" USING btree ("company_id","created_at");
CREATE INDEX "billing_invoices_company_idx" ON "billing_invoices" USING btree ("company_id");
CREATE INDEX "branches_company_idx" ON "branches" USING btree ("company_id");
CREATE INDEX "departments_company_idx" ON "departments" USING btree ("company_id");
CREATE INDEX "employee_components_emp_idx" ON "employee_components" USING btree ("employee_id");
CREATE UNIQUE INDEX "employees_company_code_uq" ON "employees" USING btree ("company_id","employee_code");
CREATE UNIQUE INDEX "employees_user_uq" ON "employees" USING btree ("company_id","user_id");
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");
CREATE INDEX "contracts_employee_idx" ON "employment_contracts" USING btree ("employee_id");
CREATE UNIQUE INDEX "holidays_company_date_uq" ON "holidays" USING btree ("company_id","date");
CREATE UNIQUE INDEX "memberships_user_company_uq" ON "memberships" USING btree ("user_id","company_id");
CREATE INDEX "memberships_company_idx" ON "memberships" USING btree ("company_id");
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");
CREATE UNIQUE INDEX "payroll_components_code_uq" ON "payroll_components" USING btree ("company_id","code","effective_from");
CREATE UNIQUE INDEX "payroll_items_run_emp_uq" ON "payroll_items" USING btree ("run_id","employee_id");
CREATE INDEX "payroll_lines_item_idx" ON "payroll_lines" USING btree ("payroll_item_id");
CREATE UNIQUE INDEX "payroll_periods_uq" ON "payroll_periods" USING btree ("company_id","year","month");
CREATE UNIQUE INDEX "payroll_rule_versions_uq" ON "payroll_rule_versions" USING btree ("company_id","rule_code","version");
CREATE UNIQUE INDEX "payroll_runs_version_uq" ON "payroll_runs" USING btree ("period_id","version");
CREATE INDEX "qr_challenges_station_idx" ON "qr_challenges" USING btree ("station_id","expires_at");
CREATE INDEX "salary_employee_idx" ON "salary_agreements" USING btree ("employee_id","effective_from");
CREATE INDEX "salary_payments_item_idx" ON "salary_payments" USING btree ("payroll_item_id");
CREATE UNIQUE INDEX "schedule_rules_day_uq" ON "schedule_rules" USING btree ("schedule_id","weekday");
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
CREATE INDEX "shift_employee_idx" ON "shift_assignments" USING btree ("employee_id","valid_from");
CREATE INDEX "subscriptions_company_idx" ON "subscriptions" USING btree ("company_id");
CREATE UNIQUE INDEX "trusted_devices_uq" ON "trusted_devices" USING btree ("employee_id","credential_id");
CREATE INDEX "locations_company_idx" ON "work_locations" USING btree ("company_id");
CREATE INDEX "locations_center_gix" ON "work_locations" USING gist ("center");
CREATE INDEX "schedules_company_idx" ON "work_schedules" USING btree ("company_id");
-- ---------------------------------------------------------------------
-- drizzle/0002_integrity_guards.sql
-- ---------------------------------------------------------------------
-- Garantias de integridade que não dependem da aplicação.

-- 1) Execuções salariais aprovadas são imutáveis (itens e linhas).
CREATE OR REPLACE FUNCTION ps_guard_payroll_immutable() RETURNS trigger AS $$
DECLARE
  v_status payroll_run_status;
BEGIN
  IF TG_TABLE_NAME = 'payroll_items' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = OLD.run_id;
  ELSE
    SELECT r.status INTO v_status
      FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
     WHERE i.id = OLD.payroll_item_id;
  END IF;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'Execução salarial aprovada é imutável (%).', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_items_immutable BEFORE UPDATE OR DELETE ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION ps_guard_payroll_immutable();

CREATE TRIGGER payroll_lines_immutable BEFORE UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION ps_guard_payroll_immutable();


-- 2) Trilho de auditoria apenas de acréscimo.
CREATE OR REPLACE FUNCTION ps_guard_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é apenas de acréscimo.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ps_guard_append_only();


-- 3) Coerência das vigências.
ALTER TABLE salary_agreements ADD CONSTRAINT salary_agreements_dates_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_dates_chk CHECK (end_date >= start_date);

ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_month_chk CHECK (month BETWEEN 1 AND 12);

ALTER TABLE schedule_rules ADD CONSTRAINT schedule_rules_weekday_chk CHECK (weekday BETWEEN 1 AND 7);

ALTER TABLE work_locations ADD CONSTRAINT work_locations_radius_chk CHECK (radius_m BETWEEN 5 AND 5000);

-- ---------------------------------------------------------------------
-- drizzle/0003_company_requests.sql
-- ---------------------------------------------------------------------
CREATE TYPE "public"."company_request_status" AS ENUM('pending', 'approved', 'rejected');
CREATE TABLE "company_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"nuit" text,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city" text,
	"employees_estimate" integer,
	"plan_id" uuid,
	"message" text,
	"status" "company_request_status" DEFAULT 'pending' NOT NULL,
	"company_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "company_requests" ADD CONSTRAINT "company_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "company_requests_status_idx" ON "company_requests" USING btree ("status","created_at");
-- ---------------------------------------------------------------------
-- drizzle/0004_supabase_lockdown.sql
-- ---------------------------------------------------------------------
-- Bloqueio da API de dados do Supabase (PostgREST).
-- A app liga-se directamente ao PostgreSQL como dona das tabelas (não é afectada).
-- Sem isto, a chave "publishable"/"anon" do Supabase permitiria ler e escrever as
-- tabelas do schema public pela API REST.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND pg_get_userbyid(c.relowner) = current_user
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;

-- Registo das migrações (permite usar "npm run db:migrate" no futuro)
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);

INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (1, '9051771c16dfb9419c5a1aa6fc00bb93231519ff2fc131e5f2dcedf8a7de973c', 1792039645851);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (2, '0030781edbe595fb4cf6c52234d55001f2023053b2ec5b7484f31d98199422ea', 1792039646813);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (3, 'c6461ed5ac8e956786a2777eab80d26aa65202ed582b77633096336b58df91c5', 1792039659051);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (4, '31d8742c97ee413702fe4d4fbfd2e27727b01c44b53a049b3d7779229d89100a', 1792043669607);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (5, '2de90943ba116ddcc2c7ff26ad4ca078dc4880eb3d4d49f9be248a85b23adc2f', 1792045252447);

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 5, true);

SELECT setval('drizzle.__drizzle_migrations_id_seq', (SELECT max(id) FROM drizzle.__drizzle_migrations));
-- Dados de referência

INSERT INTO public.permissions (id, code, module, description) VALUES
	('a8e076d7-c447-4a15-b23b-e99ed2446b13', 'platform.companies.manage', 'plataforma', 'Gerir empresas clientes'),
	('85b9c1b6-bbd6-441f-b537-6278976617fc', 'platform.plans.manage', 'plataforma', 'Gerir planos e subscrições'),
	('c3fe3b5a-618b-43fe-917e-2252e3972d6b', 'platform.billing.manage', 'plataforma', 'Gerir facturação SaaS'),
	('10c62d8f-28f4-4f6d-b5a6-c90615ea25e2', 'platform.health.view', 'plataforma', 'Ver saúde e logs da plataforma'),
	('1334a80e-fee3-4831-81fc-379953090d3b', 'company.settings.manage', 'empresa', 'Configurar a empresa e políticas'),
	('37768582-c9ae-4c5a-b20a-393828153f7f', 'users.manage', 'empresa', 'Gerir contas e papéis'),
	('2b4d3dda-9865-46c5-9f7a-12b8e3e5dc01', 'org.manage', 'empresa', 'Gerir filiais e departamentos'),
	('90a2f36a-de59-4400-95ce-ce08aaa863a7', 'employees.view', 'colaboradores', 'Ver colaboradores'),
	('a7698401-094b-4353-ae51-d0f823e33933', 'employees.manage', 'colaboradores', 'Criar e editar colaboradores'),
	('266c6944-5cf5-4b45-af86-1a28b9512bad', 'employees.salary.view', 'colaboradores', 'Ver e alterar salários'),
	('b1c9f90a-a889-41fa-b8df-14277a2f1c12', 'schedules.manage', 'horarios', 'Gerir horários, turnos e feriados'),
	('e4112bea-538e-4d55-8a95-749346284464', 'locations.manage', 'locais', 'Gerir locais, geofences e estações'),
	('119bcf6d-6386-4353-a5a9-5ce382f704d7', 'stations.display', 'locais', 'Abrir estação de QR dinâmico'),
	('6c237f21-9a1e-498d-b5b4-30612429ad4f', 'attendance.view', 'assiduidade', 'Ver assiduidade'),
	('3fc7ba19-bb19-46f3-b6e0-2f089f0e1a66', 'attendance.manage', 'assiduidade', 'Rever marcações e corrigir registos'),
	('fe186802-5d68-41e3-a0f2-32aa4d9a2c86', 'absence.decide', 'justificacoes', 'Decidir justificações (RH)'),
	('517c88c6-f3b3-4ec5-a783-433a97fdf8e1', 'absence.decide.team', 'justificacoes', 'Decidir justificações da equipa'),
	('02c50363-431f-444b-8503-30154df376d2', 'payroll.view', 'salarios', 'Consultar processamento salarial'),
	('b082f727-dae8-46fb-9bf0-7748bbf9aa8a', 'payroll.prepare', 'salarios', 'Preparar pré-processamento'),
	('c8a8ab0f-72ef-4d5d-b0df-bd5d9521252e', 'payroll.approve', 'salarios', 'Aprovar processamento salarial'),
	('8a641576-3288-487a-bb7f-a2c154dfdb4d', 'payslips.issue', 'salarios', 'Emitir recibos'),
	('96d1f599-df6f-45d3-9a49-8dbf2493a63d', 'payments.register', 'salarios', 'Registar pagamentos'),
	('ddbb335c-d0e3-42b0-92f4-db7b60e16274', 'reports.view', 'relatorios', 'Ver relatórios'),
	('06b59af0-6e8f-4ceb-b648-fe57fccd940b', 'reports.export', 'relatorios', 'Exportar relatórios'),
	('259178ac-7ccd-4efa-bcad-0823618669ea', 'audit.view', 'auditoria', 'Consultar trilho de auditoria'),
	('45f0aed6-d0f3-41ae-b6f3-0eb9e2fbb090', 'ai.use', 'ia', 'Usar o assistente administrativo'),
	('8e6a1f07-f54a-4681-b458-ae0d10014934', 'self.clock', 'colaborador', 'Marcar ponto'),
	('11456d0c-085c-49d3-8c9d-a7796150132d', 'self.history', 'colaborador', 'Consultar o próprio histórico'),
	('c9a5fcac-058a-4c73-8cd4-2c4095fc13f7', 'self.absence', 'colaborador', 'Submeter justificações'),
	('302af805-1ca0-4d0e-8609-d51f427d12a2', 'self.payslips', 'colaborador', 'Consultar os próprios recibos');

INSERT INTO public.roles (id, code, name, description) VALUES
	('a6bb262f-4f3a-46a2-a6af-6e7b7cc0a227', 'super_admin', 'Super Administrador', 'Opera a plataforma. Sem acesso salarial às empresas.'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'owner', 'Proprietário', 'Acesso total à empresa.'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'admin', 'Administrador', 'Gere a operação; não aprova salários nem regista pagamentos.'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'hr', 'Recursos Humanos', 'Assiduidade, justificações e preparação salarial.'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', 'finance', 'Financeiro', 'Aprova processamentos e regista pagamentos.'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', 'supervisor', 'Supervisor', 'Consulta e valida apenas a equipa autorizada.'),
	('8c2174b9-4d22-466f-aee4-48b5472c1b95', 'employee', 'Colaborador', 'Marcações, histórico, justificações e recibos próprios.');

INSERT INTO public.role_permissions (role_id, permission_id) VALUES
	('a6bb262f-4f3a-46a2-a6af-6e7b7cc0a227', 'a8e076d7-c447-4a15-b23b-e99ed2446b13'),
	('a6bb262f-4f3a-46a2-a6af-6e7b7cc0a227', '85b9c1b6-bbd6-441f-b537-6278976617fc'),
	('a6bb262f-4f3a-46a2-a6af-6e7b7cc0a227', 'c3fe3b5a-618b-43fe-917e-2252e3972d6b'),
	('a6bb262f-4f3a-46a2-a6af-6e7b7cc0a227', '10c62d8f-28f4-4f6d-b5a6-c90615ea25e2'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '1334a80e-fee3-4831-81fc-379953090d3b'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '37768582-c9ae-4c5a-b20a-393828153f7f'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '2b4d3dda-9865-46c5-9f7a-12b8e3e5dc01'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '90a2f36a-de59-4400-95ce-ce08aaa863a7'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'a7698401-094b-4353-ae51-d0f823e33933'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '266c6944-5cf5-4b45-af86-1a28b9512bad'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'b1c9f90a-a889-41fa-b8df-14277a2f1c12'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'e4112bea-538e-4d55-8a95-749346284464'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '119bcf6d-6386-4353-a5a9-5ce382f704d7'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '6c237f21-9a1e-498d-b5b4-30612429ad4f'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '3fc7ba19-bb19-46f3-b6e0-2f089f0e1a66'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'fe186802-5d68-41e3-a0f2-32aa4d9a2c86'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '517c88c6-f3b3-4ec5-a783-433a97fdf8e1'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '02c50363-431f-444b-8503-30154df376d2'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'b082f727-dae8-46fb-9bf0-7748bbf9aa8a'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'c8a8ab0f-72ef-4d5d-b0df-bd5d9521252e'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '8a641576-3288-487a-bb7f-a2c154dfdb4d'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '96d1f599-df6f-45d3-9a49-8dbf2493a63d'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'ddbb335c-d0e3-42b0-92f4-db7b60e16274'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '06b59af0-6e8f-4ceb-b648-fe57fccd940b'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '259178ac-7ccd-4efa-bcad-0823618669ea'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '45f0aed6-d0f3-41ae-b6f3-0eb9e2fbb090'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('d248ab67-c7bb-4a1c-bba1-3dc0ff51c1e3', '302af805-1ca0-4d0e-8609-d51f427d12a2'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '1334a80e-fee3-4831-81fc-379953090d3b'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '37768582-c9ae-4c5a-b20a-393828153f7f'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '2b4d3dda-9865-46c5-9f7a-12b8e3e5dc01'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '90a2f36a-de59-4400-95ce-ce08aaa863a7'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'a7698401-094b-4353-ae51-d0f823e33933'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'b1c9f90a-a889-41fa-b8df-14277a2f1c12'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'e4112bea-538e-4d55-8a95-749346284464'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '119bcf6d-6386-4353-a5a9-5ce382f704d7'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '6c237f21-9a1e-498d-b5b4-30612429ad4f'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '3fc7ba19-bb19-46f3-b6e0-2f089f0e1a66'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'fe186802-5d68-41e3-a0f2-32aa4d9a2c86'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '517c88c6-f3b3-4ec5-a783-433a97fdf8e1'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '02c50363-431f-444b-8503-30154df376d2'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'b082f727-dae8-46fb-9bf0-7748bbf9aa8a'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '8a641576-3288-487a-bb7f-a2c154dfdb4d'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'ddbb335c-d0e3-42b0-92f4-db7b60e16274'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '06b59af0-6e8f-4ceb-b648-fe57fccd940b'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '259178ac-7ccd-4efa-bcad-0823618669ea'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '45f0aed6-d0f3-41ae-b6f3-0eb9e2fbb090'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('534e5e15-b910-4442-afc3-c6810a6f765c', '302af805-1ca0-4d0e-8609-d51f427d12a2'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '90a2f36a-de59-4400-95ce-ce08aaa863a7'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'a7698401-094b-4353-ae51-d0f823e33933'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '266c6944-5cf5-4b45-af86-1a28b9512bad'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'b1c9f90a-a889-41fa-b8df-14277a2f1c12'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '119bcf6d-6386-4353-a5a9-5ce382f704d7'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '6c237f21-9a1e-498d-b5b4-30612429ad4f'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '3fc7ba19-bb19-46f3-b6e0-2f089f0e1a66'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'fe186802-5d68-41e3-a0f2-32aa4d9a2c86'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '02c50363-431f-444b-8503-30154df376d2'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'b082f727-dae8-46fb-9bf0-7748bbf9aa8a'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '8a641576-3288-487a-bb7f-a2c154dfdb4d'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'ddbb335c-d0e3-42b0-92f4-db7b60e16274'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '06b59af0-6e8f-4ceb-b648-fe57fccd940b'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '259178ac-7ccd-4efa-bcad-0823618669ea'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '45f0aed6-d0f3-41ae-b6f3-0eb9e2fbb090'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('3b93355b-a899-46ae-a6e4-869181e7e229', '302af805-1ca0-4d0e-8609-d51f427d12a2'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '90a2f36a-de59-4400-95ce-ce08aaa863a7'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '266c6944-5cf5-4b45-af86-1a28b9512bad'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '6c237f21-9a1e-498d-b5b4-30612429ad4f'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '02c50363-431f-444b-8503-30154df376d2'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', 'c8a8ab0f-72ef-4d5d-b0df-bd5d9521252e'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '8a641576-3288-487a-bb7f-a2c154dfdb4d'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '96d1f599-df6f-45d3-9a49-8dbf2493a63d'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', 'ddbb335c-d0e3-42b0-92f4-db7b60e16274'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '06b59af0-6e8f-4ceb-b648-fe57fccd940b'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '259178ac-7ccd-4efa-bcad-0823618669ea'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '45f0aed6-d0f3-41ae-b6f3-0eb9e2fbb090'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('f7a2a7db-8dc8-4791-bc59-7d56023f4084', '302af805-1ca0-4d0e-8609-d51f427d12a2'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '90a2f36a-de59-4400-95ce-ce08aaa863a7'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '119bcf6d-6386-4353-a5a9-5ce382f704d7'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '6c237f21-9a1e-498d-b5b4-30612429ad4f'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '517c88c6-f3b3-4ec5-a783-433a97fdf8e1'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', 'ddbb335c-d0e3-42b0-92f4-db7b60e16274'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('fb79e242-164c-4612-9ea1-3ab2d4898ee8', '302af805-1ca0-4d0e-8609-d51f427d12a2'),
	('8c2174b9-4d22-466f-aee4-48b5472c1b95', '8e6a1f07-f54a-4681-b458-ae0d10014934'),
	('8c2174b9-4d22-466f-aee4-48b5472c1b95', '11456d0c-085c-49d3-8c9d-a7796150132d'),
	('8c2174b9-4d22-466f-aee4-48b5472c1b95', 'c9a5fcac-058a-4c73-8cd4-2c4095fc13f7'),
	('8c2174b9-4d22-466f-aee4-48b5472c1b95', '302af805-1ca0-4d0e-8609-d51f427d12a2');

INSERT INTO public.subscription_plans (id, code, name, price_monthly, currency, max_employees, modules, active, created_at) VALUES
	('0a67b3d5-ae64-40dc-8409-027f7bbc3cd3', 'essencial', 'Essencial', 2500.00, 'MZN', 25, '["ponto", "assiduidade", "justificacoes"]', true, '2026-10-15 06:21:25.204654+00'),
	('166c8d48-b2e8-4238-a4b9-35b8a856dfcc', 'profissional', 'Profissional', 7500.00, 'MZN', 100, '["ponto", "assiduidade", "justificacoes", "salarios", "relatorios"]', true, '2026-10-15 06:21:25.204654+00'),
	('7891a88a-5ba3-4b06-bdf7-30167fb14e74', 'empresarial', 'Empresarial', 22000.00, 'MZN', 500, '["ponto", "assiduidade", "justificacoes", "salarios", "relatorios", "ia", "multi_filial"]', true, '2026-10-15 06:21:25.204654+00');

INSERT INTO public.payroll_rule_versions (id, company_id, jurisdiction, rule_code, name, version, params, effective_from, effective_to, validated, validated_by, source_reference, created_at) VALUES ('ff3b5986-79ec-42fe-b290-5c3a8ef236b4', NULL, 'MZ', 'INSS_ENT', 'Contribuição INSS (entidade empregadora)', 1, '{"kind": "employer_contribution", "note": "Encargo da empresa; não desconta ao colaborador.", "ratePercent": null}'::jsonb, '2020-01-01', NULL, false, NULL, 'A confirmar', now());
INSERT INTO public.payroll_rule_versions (id, company_id, jurisdiction, rule_code, name, version, params, effective_from, effective_to, validated, validated_by, source_reference, created_at) VALUES ('0b68bdfe-fe55-4d0b-9a52-6c20b2db37e3', NULL, 'MZ', 'INSS_TRAB', 'Contribuição INSS (trabalhador)', 1, '{"kind": "employee_contribution", "note": "Preencher com a taxa vigente verificada por especialista.", "ratePercent": null}'::jsonb, '2020-01-01', NULL, false, NULL, 'A confirmar — legislação de segurança social obrigatória', now());
INSERT INTO public.payroll_rule_versions (id, company_id, jurisdiction, rule_code, name, version, params, effective_from, effective_to, validated, validated_by, source_reference, created_at) VALUES ('eeedce51-853a-485a-b3f5-c3044960873c', NULL, 'MZ', 'IRPS', 'IRPS — retenção na fonte', 1, '{"kind": "income_tax", "note": "Inserir tabela de retenção vigente validada.", "brackets": []}'::jsonb, '2020-01-01', NULL, false, NULL, 'A confirmar — tabela de retenção do IRPS', now());

COMMIT;
