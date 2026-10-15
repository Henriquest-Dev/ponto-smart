-- Horbit — tabelas para o Supabase (colar no SQL Editor e clicar Run, uma única vez)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TYPE absence_status AS ENUM('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE ai_approval_status AS ENUM('not_required', 'pending', 'approved', 'rejected');
CREATE TYPE approval_decision AS ENUM('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE attendance_event_status AS ENUM('accepted', 'review', 'rejected');
CREATE TYPE attendance_event_type AS ENUM('in', 'out', 'break_start', 'break_end');
CREATE TYPE company_status AS ENUM('trial', 'active', 'suspended', 'cancelled');
CREATE TYPE component_calc AS ENUM('fixed', 'percent_base', 'per_hour');
CREATE TYPE component_nature AS ENUM('earning', 'deduction');
CREATE TYPE contract_type AS ENUM('indeterminado', 'determinado', 'estagio', 'prestacao_servicos');
CREATE TYPE daily_status AS ENUM('on_time', 'late', 'incomplete', 'absent_pending', 'justified', 'unjustified', 'review', 'holiday', 'day_off', 'present');
CREATE TYPE device_result AS ENUM('trusted', 'unknown', 'revoked', 'not_required');
CREATE TYPE employee_status AS ENUM('active', 'inactive', 'terminated');
CREATE TYPE geofence_result AS ENUM('inside', 'outside', 'inconclusive', 'unavailable');
CREATE TYPE invoice_status AS ENUM('draft', 'issued', 'paid', 'void');
CREATE TYPE payroll_period_status AS ENUM('open', 'attendance_closed', 'approved', 'closed');
CREATE TYPE payroll_run_status AS ENUM('draft', 'approved', 'superseded');
CREATE TYPE qr_mode AS ENUM('dynamic', 'static');
CREATE TYPE subscription_status AS ENUM('trialing', 'active', 'past_due', 'cancelled');
CREATE TYPE user_status AS ENUM('active', 'invited', 'disabled');
CREATE TABLE absence_documents (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	request_id uuid NOT NULL,
	storage_key text NOT NULL,
	file_name text NOT NULL,
	mime_type text NOT NULL,
	size_bytes integer NOT NULL,
	uploaded_by uuid,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE absence_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	start_date date NOT NULL,
	end_date date NOT NULL,
	type text NOT NULL,
	reason text NOT NULL,
	status absence_status DEFAULT 'pending' NOT NULL,
	created_by uuid,
	decided_at timestamp with time zone,
	decision_reason text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE ai_conversations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	user_id uuid NOT NULL,
	title text NOT NULL,
	messages jsonb DEFAULT '[]'::jsonb NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE ai_tool_executions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	conversation_id uuid NOT NULL,
	tool text NOT NULL,
	input jsonb NOT NULL,
	output jsonb,
	approval_status ai_approval_status DEFAULT 'not_required' NOT NULL,
	approved_by uuid,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE approval_steps (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	request_id uuid NOT NULL,
	step_order smallint NOT NULL,
	approver_role text NOT NULL,
	approver_id uuid,
	decision approval_decision DEFAULT 'pending' NOT NULL,
	reason text,
	decided_at timestamp with time zone
);
CREATE TABLE attendance_adjustments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	work_date date NOT NULL,
	author_id uuid NOT NULL,
	reason text NOT NULL,
	previous jsonb,
	next jsonb,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE attendance_daily (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	work_date date NOT NULL,
	schedule_id uuid,
	expected_start timestamp with time zone,
	expected_end timestamp with time zone,
	first_in timestamp with time zone,
	last_out timestamp with time zone,
	worked_minutes integer DEFAULT 0 NOT NULL,
	break_minutes integer DEFAULT 0 NOT NULL,
	late_minutes integer DEFAULT 0 NOT NULL,
	overtime_minutes integer DEFAULT 0 NOT NULL,
	status daily_status NOT NULL,
	absence_request_id uuid,
	locked boolean DEFAULT false NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE attendance_events (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	station_id uuid,
	location_id uuid,
	type attendance_event_type NOT NULL,
	occurred_at timestamp with time zone DEFAULT now() NOT NULL,
	work_date date NOT NULL,
	status attendance_event_status NOT NULL,
	source text DEFAULT 'qr' NOT NULL,
	idempotency_key text NOT NULL,
	device_id uuid,
	reason text,
	reviewed_by uuid,
	reviewed_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE attendance_stations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	location_id uuid NOT NULL,
	name text NOT NULL,
	qr_mode qr_mode DEFAULT 'dynamic' NOT NULL,
	static_token_hash text,
	rotation_seconds integer DEFAULT 30 NOT NULL,
	active boolean DEFAULT true NOT NULL,
	last_seen_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE attendance_validations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	event_id uuid NOT NULL,
	qr_mode qr_mode,
	token_valid boolean NOT NULL,
	latitude numeric(9, 6),
	longitude numeric(9, 6),
	accuracy_m numeric(8, 1),
	distance_m numeric(10, 1),
	geofence_result geofence_result NOT NULL,
	device_result device_result NOT NULL,
	details jsonb,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE audit_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid,
	actor_id uuid,
	action text NOT NULL,
	entity text NOT NULL,
	entity_id text,
	before jsonb,
	after jsonb,
	ip text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE billing_invoices (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	subscription_id uuid NOT NULL,
	number text NOT NULL,
	amount numeric(14, 2) NOT NULL,
	currency text DEFAULT 'MZN' NOT NULL,
	status invoice_status DEFAULT 'issued' NOT NULL,
	issued_at date NOT NULL,
	due_at date NOT NULL,
	paid_at date,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT billing_invoices_number_unique UNIQUE(number)
);
CREATE TABLE branches (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	name text NOT NULL,
	address text,
	city text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE companies (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	name text NOT NULL,
	legal_name text,
	nuit text,
	email text,
	phone text,
	address text,
	timezone text DEFAULT 'Africa/Maputo' NOT NULL,
	currency text DEFAULT 'MZN' NOT NULL,
	status company_status DEFAULT 'trial' NOT NULL,
	settings jsonb DEFAULT '{"devicePolicy":"warn","absenceFlow":"supervisor_then_hr","requireMfaForAdmins":false,"duplicateWindowMinutes":2,"payrollDailyDivisor":30}'::jsonb NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE departments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	branch_id uuid,
	name text NOT NULL,
	manager_user_id uuid,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE employee_components (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	component_id uuid NOT NULL,
	amount numeric(14, 2) NOT NULL,
	effective_from date NOT NULL,
	effective_to date,
	note text
);
CREATE TABLE employees (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	user_id uuid,
	employee_code text NOT NULL,
	full_name text NOT NULL,
	email text,
	phone text,
	job_title text,
	department_id uuid,
	branch_id uuid,
	hire_date date,
	status employee_status DEFAULT 'active' NOT NULL,
	nuit text,
	bank_account text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE employment_contracts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	type contract_type NOT NULL,
	start_date date NOT NULL,
	end_date date,
	weekly_hours integer DEFAULT 40 NOT NULL,
	notes text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE holidays (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	date date NOT NULL,
	name text NOT NULL,
	recurring boolean DEFAULT true NOT NULL
);
CREATE TABLE memberships (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	company_id uuid NOT NULL,
	role_id uuid NOT NULL,
	active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE notifications (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	user_id uuid NOT NULL,
	kind text NOT NULL,
	title text NOT NULL,
	body text,
	link text,
	read_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE payroll_components (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	code text NOT NULL,
	name text NOT NULL,
	nature component_nature NOT NULL,
	calc_type component_calc NOT NULL,
	rate numeric(12, 4),
	taxable boolean DEFAULT true NOT NULL,
	effective_from date NOT NULL,
	effective_to date,
	active boolean DEFAULT true NOT NULL
);
CREATE TABLE payroll_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	run_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	gross numeric(14, 2) NOT NULL,
	deductions numeric(14, 2) NOT NULL,
	net numeric(14, 2) NOT NULL,
	currency text DEFAULT 'MZN' NOT NULL,
	snapshot jsonb NOT NULL
);
CREATE TABLE payroll_lines (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	payroll_item_id uuid NOT NULL,
	code text NOT NULL,
	description text NOT NULL,
	nature component_nature NOT NULL,
	quantity numeric(12, 4),
	rate numeric(14, 4),
	amount numeric(14, 2) NOT NULL,
	origin text NOT NULL,
	rule_version_id uuid,
	sort smallint DEFAULT 0 NOT NULL
);
CREATE TABLE payroll_periods (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	year smallint NOT NULL,
	month smallint NOT NULL,
	status payroll_period_status DEFAULT 'open' NOT NULL,
	attendance_closed_at timestamp with time zone,
	closed_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE payroll_rule_versions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid,
	jurisdiction text DEFAULT 'MZ' NOT NULL,
	rule_code text NOT NULL,
	name text NOT NULL,
	version integer NOT NULL,
	params jsonb NOT NULL,
	effective_from date NOT NULL,
	effective_to date,
	validated boolean DEFAULT false NOT NULL,
	validated_by text,
	source_reference text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE payroll_runs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	period_id uuid NOT NULL,
	version integer NOT NULL,
	status payroll_run_status DEFAULT 'draft' NOT NULL,
	engine_version text NOT NULL,
	input_hash text NOT NULL,
	prepared_by uuid NOT NULL,
	prepared_at timestamp with time zone DEFAULT now() NOT NULL,
	approved_by uuid,
	approved_at timestamp with time zone,
	totals jsonb NOT NULL,
	warnings jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE payslip_acknowledgements (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	payslip_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
	ip text,
	CONSTRAINT payslip_acknowledgements_payslip_id_unique UNIQUE(payslip_id)
);
CREATE TABLE payslips (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	payroll_item_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	run_id uuid NOT NULL,
	reference text NOT NULL,
	document_key text,
	issued_by uuid NOT NULL,
	issued_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT payslips_payroll_item_id_unique UNIQUE(payroll_item_id),
	CONSTRAINT payslips_reference_unique UNIQUE(reference)
);
CREATE TABLE permissions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	code text NOT NULL,
	module text NOT NULL,
	description text NOT NULL,
	CONSTRAINT permissions_code_unique UNIQUE(code)
);
CREATE TABLE qr_challenges (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	station_id uuid NOT NULL,
	token_hash text NOT NULL,
	issued_at timestamp with time zone DEFAULT now() NOT NULL,
	expires_at timestamp with time zone NOT NULL,
	CONSTRAINT qr_challenges_token_hash_unique UNIQUE(token_hash)
);
CREATE TABLE rate_limits (
	key text PRIMARY KEY NOT NULL,
	window_start timestamp with time zone NOT NULL,
	count integer DEFAULT 0 NOT NULL
);
CREATE TABLE role_permissions (
	role_id uuid NOT NULL,
	permission_id uuid NOT NULL,
	CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE roles (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	code text NOT NULL,
	name text NOT NULL,
	description text,
	CONSTRAINT roles_code_unique UNIQUE(code)
);
CREATE TABLE salary_agreements (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	amount numeric(14, 2) NOT NULL,
	currency text DEFAULT 'MZN' NOT NULL,
	effective_from date NOT NULL,
	effective_to date,
	created_by uuid,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE salary_payments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	payroll_item_id uuid NOT NULL,
	amount numeric(14, 2) NOT NULL,
	paid_at date NOT NULL,
	method text NOT NULL,
	reference text,
	registered_by uuid NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE schedule_rules (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	schedule_id uuid NOT NULL,
	weekday smallint NOT NULL,
	start_time time NOT NULL,
	end_time time NOT NULL,
	break_minutes integer DEFAULT 60 NOT NULL
);
CREATE TABLE sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	token_hash text NOT NULL,
	company_id uuid,
	mfa_pending boolean DEFAULT false NOT NULL,
	expires_at timestamp with time zone NOT NULL,
	ip text,
	user_agent text,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT sessions_token_hash_unique UNIQUE(token_hash)
);
CREATE TABLE shift_assignments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	schedule_id uuid NOT NULL,
	valid_from date NOT NULL,
	valid_to date
);
CREATE TABLE subscription_plans (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	code text NOT NULL,
	name text NOT NULL,
	price_monthly numeric(14, 2) NOT NULL,
	currency text DEFAULT 'MZN' NOT NULL,
	max_employees integer NOT NULL,
	modules jsonb DEFAULT '[]'::jsonb NOT NULL,
	active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT subscription_plans_code_unique UNIQUE(code)
);
CREATE TABLE subscriptions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	plan_id uuid NOT NULL,
	status subscription_status DEFAULT 'trialing' NOT NULL,
	billing_cycle text DEFAULT 'monthly' NOT NULL,
	current_period_start date NOT NULL,
	current_period_end date NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE trusted_devices (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	employee_id uuid NOT NULL,
	credential_id text NOT NULL,
	label text NOT NULL,
	user_agent text,
	last_used_at timestamp with time zone,
	revoked_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	email text NOT NULL,
	name text NOT NULL,
	password_hash text NOT NULL,
	status user_status DEFAULT 'active' NOT NULL,
	is_platform_admin boolean DEFAULT false NOT NULL,
	mfa_secret text,
	mfa_enabled boolean DEFAULT false NOT NULL,
	last_login_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT users_email_unique UNIQUE(email)
);
CREATE TABLE work_locations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	branch_id uuid,
	name text NOT NULL,
	center_lat numeric(9, 6) NOT NULL,
	center_lng numeric(9, 6) NOT NULL,
	radius_m integer DEFAULT 60 NOT NULL,
	center geography(Point,4326) NOT NULL,
	geom geography(Polygon,4326),
	max_accuracy_m integer DEFAULT 80 NOT NULL,
	active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE work_schedules (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_id uuid NOT NULL,
	name text NOT NULL,
	timezone text DEFAULT 'Africa/Maputo' NOT NULL,
	tolerance_minutes integer DEFAULT 10 NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX absence_requests_company_idx ON absence_requests (company_id,status);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (company_id,user_id);
CREATE UNIQUE INDEX approval_steps_order_uq ON approval_steps (request_id,step_order);
CREATE INDEX attendance_adjustments_emp_idx ON attendance_adjustments (company_id,employee_id,work_date);
CREATE UNIQUE INDEX attendance_daily_emp_date_uq ON attendance_daily (employee_id,work_date);
CREATE INDEX attendance_daily_company_date_idx ON attendance_daily (company_id,work_date);
CREATE UNIQUE INDEX attendance_events_idem_uq ON attendance_events (company_id,employee_id,idempotency_key);
CREATE INDEX attendance_events_emp_idx ON attendance_events (company_id,employee_id,occurred_at);
CREATE INDEX attendance_events_status_idx ON attendance_events (company_id,status);
CREATE INDEX stations_company_idx ON attendance_stations (company_id);
CREATE INDEX attendance_validations_event_idx ON attendance_validations (event_id);
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id,created_at);
CREATE INDEX billing_invoices_company_idx ON billing_invoices (company_id);
CREATE INDEX branches_company_idx ON branches (company_id);
CREATE INDEX departments_company_idx ON departments (company_id);
CREATE INDEX employee_components_emp_idx ON employee_components (employee_id);
CREATE UNIQUE INDEX employees_company_code_uq ON employees (company_id,employee_code);
CREATE UNIQUE INDEX employees_user_uq ON employees (company_id,user_id);
CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX contracts_employee_idx ON employment_contracts (employee_id);
CREATE UNIQUE INDEX holidays_company_date_uq ON holidays (company_id,date);
CREATE UNIQUE INDEX memberships_user_company_uq ON memberships (user_id,company_id);
CREATE INDEX memberships_company_idx ON memberships (company_id);
CREATE INDEX notifications_user_idx ON notifications (user_id,read_at);
CREATE UNIQUE INDEX payroll_components_code_uq ON payroll_components (company_id,code,effective_from);
CREATE UNIQUE INDEX payroll_items_run_emp_uq ON payroll_items (run_id,employee_id);
CREATE INDEX payroll_lines_item_idx ON payroll_lines (payroll_item_id);
CREATE UNIQUE INDEX payroll_periods_uq ON payroll_periods (company_id,year,month);
CREATE UNIQUE INDEX payroll_rule_versions_uq ON payroll_rule_versions (company_id,rule_code,version);
CREATE UNIQUE INDEX payroll_runs_version_uq ON payroll_runs (period_id,version);
CREATE INDEX qr_challenges_station_idx ON qr_challenges (station_id,expires_at);
CREATE INDEX salary_employee_idx ON salary_agreements (employee_id,effective_from);
CREATE INDEX salary_payments_item_idx ON salary_payments (payroll_item_id);
CREATE UNIQUE INDEX schedule_rules_day_uq ON schedule_rules (schedule_id,weekday);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX shift_employee_idx ON shift_assignments (employee_id,valid_from);
CREATE INDEX subscriptions_company_idx ON subscriptions (company_id);
CREATE UNIQUE INDEX trusted_devices_uq ON trusted_devices (employee_id,credential_id);
CREATE INDEX locations_company_idx ON work_locations (company_id);
CREATE INDEX locations_center_gix ON work_locations USING gist (center);
CREATE INDEX schedules_company_idx ON work_schedules (company_id);
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
CREATE OR REPLACE FUNCTION ps_guard_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é apenas de acréscimo.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ps_guard_append_only();
ALTER TABLE salary_agreements ADD CONSTRAINT salary_agreements_dates_chk
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_dates_chk CHECK (end_date >= start_date);
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_month_chk CHECK (month BETWEEN 1 AND 12);
ALTER TABLE schedule_rules ADD CONSTRAINT schedule_rules_weekday_chk CHECK (weekday BETWEEN 1 AND 7);
ALTER TABLE work_locations ADD CONSTRAINT work_locations_radius_chk CHECK (radius_m BETWEEN 5 AND 5000);
CREATE TYPE company_request_status AS ENUM('pending', 'approved', 'rejected');
CREATE TABLE company_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	company_name text NOT NULL,
	nuit text,
	contact_name text NOT NULL,
	email text NOT NULL,
	phone text,
	city text,
	employees_estimate integer,
	plan_id uuid,
	message text,
	status company_request_status DEFAULT 'pending' NOT NULL,
	company_id uuid,
	decided_by uuid,
	decided_at timestamp with time zone,
	ip text,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX company_requests_status_idx ON company_requests (status,created_at);
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
-- Chaves estrangeiras
ALTER TABLE absence_documents
  ADD CONSTRAINT absence_documents_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT absence_documents_request_id_absence_requests_id_fk FOREIGN KEY (request_id) REFERENCES absence_requests(id) ON DELETE cascade,
  ADD CONSTRAINT absence_documents_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES users(id);
ALTER TABLE absence_requests
  ADD CONSTRAINT absence_requests_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT absence_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT absence_requests_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT ai_conversations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
ALTER TABLE ai_tool_executions
  ADD CONSTRAINT ai_tool_executions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT ai_tool_executions_conversation_id_ai_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE cascade,
  ADD CONSTRAINT ai_tool_executions_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES users(id);
ALTER TABLE approval_steps
  ADD CONSTRAINT approval_steps_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT approval_steps_request_id_absence_requests_id_fk FOREIGN KEY (request_id) REFERENCES absence_requests(id) ON DELETE cascade,
  ADD CONSTRAINT approval_steps_approver_id_users_id_fk FOREIGN KEY (approver_id) REFERENCES users(id);
ALTER TABLE attendance_adjustments
  ADD CONSTRAINT attendance_adjustments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_adjustments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_adjustments_author_id_users_id_fk FOREIGN KEY (author_id) REFERENCES users(id);
ALTER TABLE attendance_daily
  ADD CONSTRAINT attendance_daily_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_daily_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_daily_schedule_id_work_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES work_schedules(id) ON DELETE set null;
ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_events_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_events_station_id_attendance_stations_id_fk FOREIGN KEY (station_id) REFERENCES attendance_stations(id) ON DELETE set null,
  ADD CONSTRAINT attendance_events_location_id_work_locations_id_fk FOREIGN KEY (location_id) REFERENCES work_locations(id) ON DELETE set null,
  ADD CONSTRAINT attendance_events_device_id_trusted_devices_id_fk FOREIGN KEY (device_id) REFERENCES trusted_devices(id) ON DELETE set null,
  ADD CONSTRAINT attendance_events_reviewed_by_users_id_fk FOREIGN KEY (reviewed_by) REFERENCES users(id);
ALTER TABLE attendance_stations
  ADD CONSTRAINT attendance_stations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_stations_location_id_work_locations_id_fk FOREIGN KEY (location_id) REFERENCES work_locations(id) ON DELETE cascade;
ALTER TABLE attendance_validations
  ADD CONSTRAINT attendance_validations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT attendance_validations_event_id_attendance_events_id_fk FOREIGN KEY (event_id) REFERENCES attendance_events(id) ON DELETE cascade;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE set null,
  ADD CONSTRAINT audit_logs_actor_id_users_id_fk FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE set null;
ALTER TABLE billing_invoices
  ADD CONSTRAINT billing_invoices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT billing_invoices_subscription_id_subscriptions_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE cascade;
ALTER TABLE branches
  ADD CONSTRAINT branches_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE departments
  ADD CONSTRAINT departments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT departments_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE set null,
  ADD CONSTRAINT departments_manager_user_id_users_id_fk FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE set null;
ALTER TABLE employee_components
  ADD CONSTRAINT employee_components_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT employee_components_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT employee_components_component_id_payroll_components_id_fk FOREIGN KEY (component_id) REFERENCES payroll_components(id) ON DELETE cascade;
ALTER TABLE employees
  ADD CONSTRAINT employees_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT employees_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE set null,
  ADD CONSTRAINT employees_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE set null,
  ADD CONSTRAINT employees_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE set null;
ALTER TABLE employment_contracts
  ADD CONSTRAINT employment_contracts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT employment_contracts_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade;
ALTER TABLE holidays
  ADD CONSTRAINT holidays_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
  ADD CONSTRAINT memberships_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT memberships_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES roles(id);
ALTER TABLE notifications
  ADD CONSTRAINT notifications_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
ALTER TABLE payroll_components
  ADD CONSTRAINT payroll_components_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE payroll_items
  ADD CONSTRAINT payroll_items_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_items_run_id_payroll_runs_id_fk FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_items_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade;
ALTER TABLE payroll_lines
  ADD CONSTRAINT payroll_lines_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_lines_payroll_item_id_payroll_items_id_fk FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_lines_rule_version_id_payroll_rule_versions_id_fk FOREIGN KEY (rule_version_id) REFERENCES payroll_rule_versions(id);
ALTER TABLE payroll_periods
  ADD CONSTRAINT payroll_periods_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE payroll_rule_versions
  ADD CONSTRAINT payroll_rule_versions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_runs_period_id_payroll_periods_id_fk FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE cascade,
  ADD CONSTRAINT payroll_runs_prepared_by_users_id_fk FOREIGN KEY (prepared_by) REFERENCES users(id),
  ADD CONSTRAINT payroll_runs_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES users(id);
ALTER TABLE payslip_acknowledgements
  ADD CONSTRAINT payslip_acknowledgements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT payslip_acknowledgements_payslip_id_payslips_id_fk FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE cascade,
  ADD CONSTRAINT payslip_acknowledgements_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade;
ALTER TABLE payslips
  ADD CONSTRAINT payslips_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT payslips_payroll_item_id_payroll_items_id_fk FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id) ON DELETE cascade,
  ADD CONSTRAINT payslips_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT payslips_run_id_payroll_runs_id_fk FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE cascade,
  ADD CONSTRAINT payslips_issued_by_users_id_fk FOREIGN KEY (issued_by) REFERENCES users(id);
ALTER TABLE qr_challenges
  ADD CONSTRAINT qr_challenges_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT qr_challenges_station_id_attendance_stations_id_fk FOREIGN KEY (station_id) REFERENCES attendance_stations(id) ON DELETE cascade;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE cascade,
  ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE cascade;
ALTER TABLE salary_agreements
  ADD CONSTRAINT salary_agreements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT salary_agreements_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT salary_agreements_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE salary_payments
  ADD CONSTRAINT salary_payments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT salary_payments_payroll_item_id_payroll_items_id_fk FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id) ON DELETE cascade,
  ADD CONSTRAINT salary_payments_registered_by_users_id_fk FOREIGN KEY (registered_by) REFERENCES users(id);
ALTER TABLE schedule_rules
  ADD CONSTRAINT schedule_rules_schedule_id_work_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES work_schedules(id) ON DELETE cascade;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
  ADD CONSTRAINT sessions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE set null;
ALTER TABLE shift_assignments
  ADD CONSTRAINT shift_assignments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT shift_assignments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade,
  ADD CONSTRAINT shift_assignments_schedule_id_work_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES work_schedules(id) ON DELETE cascade;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT subscriptions_plan_id_subscription_plans_id_fk FOREIGN KEY (plan_id) REFERENCES subscription_plans(id);
ALTER TABLE trusted_devices
  ADD CONSTRAINT trusted_devices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT trusted_devices_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE cascade;
ALTER TABLE work_locations
  ADD CONSTRAINT work_locations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade,
  ADD CONSTRAINT work_locations_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE set null;
ALTER TABLE work_schedules
  ADD CONSTRAINT work_schedules_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE cascade;
ALTER TABLE company_requests
  ADD CONSTRAINT company_requests_plan_id_subscription_plans_id_fk FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE set null,
  ADD CONSTRAINT company_requests_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE set null,
  ADD CONSTRAINT company_requests_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES users(id);
-- Registo das migrações (permite "npm run db:migrate" no futuro)
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('9051771c16dfb9419c5a1aa6fc00bb93231519ff2fc131e5f2dcedf8a7de973c', 1792039645851),
  ('0030781edbe595fb4cf6c52234d55001f2023053b2ec5b7484f31d98199422ea', 1792039646813),
  ('c6461ed5ac8e956786a2777eab80d26aa65202ed582b77633096336b58df91c5', 1792039659051),
  ('31d8742c97ee413702fe4d4fbfd2e27727b01c44b53a049b3d7779229d89100a', 1792043669607),
  ('2de90943ba116ddcc2c7ff26ad4ca078dc4880eb3d4d49f9be248a85b23adc2f', 1792045252447);
-- Permissões, papéis, planos e regras salariais (por validar)
INSERT INTO permissions (code, module, description) VALUES
  ('absence.decide', 'justificacoes', 'Decidir justificações (RH)'),
  ('absence.decide.team', 'justificacoes', 'Decidir justificações da equipa'),
  ('ai.use', 'ia', 'Usar o assistente administrativo'),
  ('attendance.manage', 'assiduidade', 'Rever marcações e corrigir registos'),
  ('attendance.view', 'assiduidade', 'Ver assiduidade'),
  ('audit.view', 'auditoria', 'Consultar trilho de auditoria'),
  ('company.settings.manage', 'empresa', 'Configurar a empresa e políticas'),
  ('employees.manage', 'colaboradores', 'Criar e editar colaboradores'),
  ('employees.salary.view', 'colaboradores', 'Ver e alterar salários'),
  ('employees.view', 'colaboradores', 'Ver colaboradores'),
  ('locations.manage', 'locais', 'Gerir locais, geofences e estações'),
  ('org.manage', 'empresa', 'Gerir filiais e departamentos'),
  ('payments.register', 'salarios', 'Registar pagamentos'),
  ('payroll.approve', 'salarios', 'Aprovar processamento salarial'),
  ('payroll.prepare', 'salarios', 'Preparar pré-processamento'),
  ('payroll.view', 'salarios', 'Consultar processamento salarial'),
  ('payslips.issue', 'salarios', 'Emitir recibos'),
  ('platform.billing.manage', 'plataforma', 'Gerir facturação SaaS'),
  ('platform.companies.manage', 'plataforma', 'Gerir empresas clientes'),
  ('platform.health.view', 'plataforma', 'Ver saúde e logs da plataforma'),
  ('platform.plans.manage', 'plataforma', 'Gerir planos e subscrições'),
  ('reports.export', 'relatorios', 'Exportar relatórios'),
  ('reports.view', 'relatorios', 'Ver relatórios'),
  ('schedules.manage', 'horarios', 'Gerir horários, turnos e feriados'),
  ('self.absence', 'colaborador', 'Submeter justificações'),
  ('self.clock', 'colaborador', 'Marcar ponto'),
  ('self.history', 'colaborador', 'Consultar o próprio histórico'),
  ('self.payslips', 'colaborador', 'Consultar os próprios recibos'),
  ('stations.display', 'locais', 'Abrir estação de QR dinâmico'),
  ('users.manage', 'empresa', 'Gerir contas e papéis');
INSERT INTO roles (code, name, description) VALUES
  ('admin', 'Administrador', 'Gere a operação; não aprova salários nem regista pagamentos.'),
  ('employee', 'Colaborador', 'Marcações, histórico, justificações e recibos próprios.'),
  ('finance', 'Financeiro', 'Aprova processamentos e regista pagamentos.'),
  ('hr', 'Recursos Humanos', 'Assiduidade, justificações e preparação salarial.'),
  ('owner', 'Proprietário', 'Acesso total à empresa.'),
  ('super_admin', 'Super Administrador', 'Opera a plataforma. Sem acesso salarial às empresas.'),
  ('supervisor', 'Supervisor', 'Consulta e valida apenas a equipa autorizada.');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('admin', ARRAY['absence.decide', 'absence.decide.team', 'ai.use', 'attendance.manage', 'attendance.view', 'audit.view', 'company.settings.manage', 'employees.manage', 'employees.view', 'locations.manage', 'org.manage', 'payroll.prepare', 'payroll.view', 'payslips.issue', 'reports.export', 'reports.view', 'schedules.manage', 'self.absence', 'self.clock', 'self.history', 'self.payslips', 'stations.display', 'users.manage']),
  ('employee', ARRAY['self.absence', 'self.clock', 'self.history', 'self.payslips']),
  ('finance', ARRAY['ai.use', 'attendance.view', 'audit.view', 'employees.salary.view', 'employees.view', 'payments.register', 'payroll.approve', 'payroll.view', 'payslips.issue', 'reports.export', 'reports.view', 'self.absence', 'self.clock', 'self.history', 'self.payslips']),
  ('hr', ARRAY['absence.decide', 'ai.use', 'attendance.manage', 'attendance.view', 'audit.view', 'employees.manage', 'employees.salary.view', 'employees.view', 'payroll.prepare', 'payroll.view', 'payslips.issue', 'reports.export', 'reports.view', 'schedules.manage', 'self.absence', 'self.clock', 'self.history', 'self.payslips', 'stations.display']),
  ('owner', ARRAY['absence.decide', 'absence.decide.team', 'ai.use', 'attendance.manage', 'attendance.view', 'audit.view', 'company.settings.manage', 'employees.manage', 'employees.salary.view', 'employees.view', 'locations.manage', 'org.manage', 'payments.register', 'payroll.approve', 'payroll.prepare', 'payroll.view', 'payslips.issue', 'reports.export', 'reports.view', 'schedules.manage', 'self.absence', 'self.clock', 'self.history', 'self.payslips', 'stations.display', 'users.manage']),
  ('super_admin', ARRAY['platform.billing.manage', 'platform.companies.manage', 'platform.health.view', 'platform.plans.manage']),
  ('supervisor', ARRAY['absence.decide.team', 'attendance.view', 'employees.view', 'reports.view', 'self.absence', 'self.clock', 'self.history', 'self.payslips', 'stations.display'])
) AS m(role, perms)
JOIN roles r ON r.code = m.role
JOIN permissions p ON p.code = ANY (m.perms);
INSERT INTO subscription_plans (code, name, price_monthly, max_employees, modules) VALUES
  ('essencial', 'Essencial', 2500.00, 25, '["ponto", "assiduidade", "justificacoes"]'),
  ('profissional', 'Profissional', 7500.00, 100, '["ponto", "assiduidade", "justificacoes", "salarios", "relatorios"]'),
  ('empresarial', 'Empresarial', 22000.00, 500, '["ponto", "assiduidade", "justificacoes", "salarios", "relatorios", "ia", "multi_filial"]');
INSERT INTO payroll_rule_versions (rule_code, name, version, params, effective_from, validated, source_reference) VALUES
  ('INSS_ENT', 'Contribuição INSS (entidade empregadora)', 1, '{"kind": "employer_contribution", "note": "Encargo da empresa; não desconta ao colaborador.", "ratePercent": null}', '2020-01-01', false, 'A confirmar'),
  ('INSS_TRAB', 'Contribuição INSS (trabalhador)', 1, '{"kind": "employee_contribution", "note": "Preencher com a taxa vigente verificada por especialista.", "ratePercent": null}', '2020-01-01', false, 'A confirmar — legislação de segurança social obrigatória'),
  ('IRPS', 'IRPS — retenção na fonte', 1, '{"kind": "income_tax", "note": "Inserir tabela de retenção vigente validada.", "brackets": []}', '2020-01-01', false, 'A confirmar — tabela de retenção do IRPS');
COMMIT;
