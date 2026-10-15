-- =====================================================================
-- PontoSmart — Script 4: ligar o site ao Supabase
-- Executar no SQL Editor DEPOIS do 01_esquema.sql. Pode ser executado
-- de novo sem estragar dados (todas as instruções são repetíveis).
--
-- O que faz:
--   * login pelo Supabase Auth (utilizadores de public.users passam a ter conta em auth.users)
--   * regras de acesso (RLS) por empresa, papel e equipa
--   * funções (RPC) para marcar ponto, QR dinâmico, justificações, salários,
--     criação de empresas e de credenciais
--   * armazenamento privado de anexos (Storage)
--   * auditoria automática das alterações
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Tabela privada para segredos internos (sem acesso pela API).
CREATE TABLE IF NOT EXISTS ps_secrets (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE ps_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ps_secrets FROM PUBLIC;

-- Unicidade usada pelas funções (repetível).
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_company_uq ON memberships (user_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_daily_emp_date_uq ON attendance_daily (employee_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_periods_company_month_uq ON payroll_periods (company_id, year, month);

-- ---------------------------------------------------------------------
-- 1. Contas: public.users <-> auth.users (mesmo id)
-- ---------------------------------------------------------------------

-- Nome de utilizador sem "@" vira um email interno (o Supabase Auth exige email).
CREATE OR REPLACE FUNCTION ps_login_email(p_login text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN position('@' IN lower(trim(p_login))) > 0 THEN lower(trim(p_login))
              ELSE lower(trim(p_login)) || '@pontosmart.app' END
$$;

CREATE OR REPLACE FUNCTION ps_auth_upsert(p_id uuid, p_login text, p_password text DEFAULT NULL, p_hash text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_email text := ps_login_email(p_login);
  v_hash text;
BEGIN
  IF p_password IS NOT NULL THEN
    IF length(p_password) < 8 THEN
      RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 8 caracteres.' USING ERRCODE = '22023';
    END IF;
    v_hash := crypt(p_password, gen_salt('bf', 10));
  ELSE
    v_hash := p_hash;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_id) THEN
    UPDATE auth.users
       SET email = v_email,
           encrypted_password = COALESCE(v_hash, encrypted_password),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           banned_until = NULL,
           updated_at = now()
     WHERE id = p_id;
    UPDATE auth.identities
       SET identity_data = jsonb_build_object('sub', p_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
           updated_at = now()
     WHERE user_id = p_id AND provider = 'email';
    IF NOT FOUND THEN
      INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
              'email', now(), now(), now());
    END IF;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Já existe uma conta com o acesso "%".', p_login USING ERRCODE = '23505';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token)
  VALUES (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', v_email,
    COALESCE(v_hash, crypt(gen_random_uuid()::text, gen_salt('bf', 10))), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('login', lower(trim(p_login))),
    now(), now(), '', '', '', '', '', '');
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
END $$;

-- Bloqueia o login de uma conta (sem a apagar).
CREATE OR REPLACE FUNCTION ps_auth_disable(p_id uuid, p_disabled boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE auth.users SET banned_until = CASE WHEN p_disabled THEN 'infinity'::timestamptz END, updated_at = now() WHERE id = p_id;
$$;

-- Contas que já existiam em public.users passam para o Supabase Auth
-- (o bcrypt é compatível, por isso as palavras-passe mantêm-se).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT u.id, u.email, u.password_hash FROM users u WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id) LOOP
    BEGIN
      PERFORM ps_auth_upsert(r.id, r.email, NULL, CASE WHEN r.password_hash LIKE '$2%' THEN r.password_hash END);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Conta % já existe no Auth com outro id; ignorada.', r.email;
    END;
  END LOOP;
END $$;
UPDATE users SET password_hash = 'supabase-auth' WHERE password_hash <> 'supabase-auth';
UPDATE users SET mfa_secret = NULL, mfa_enabled = false WHERE mfa_secret IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Funções de contexto (usadas pelas regras de acesso)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;

CREATE OR REPLACE FUNCTION ps_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM users WHERE id = auth.uid() AND status = 'active'), false)
$$;

CREATE OR REPLACE FUNCTION ps_is_member(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = auth.uid() AND m.company_id = p_company AND m.active
       AND c.status IN ('trial', 'active'))
$$;

CREATE OR REPLACE FUNCTION ps_has_perm(p_company uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
      JOIN companies c ON c.id = m.company_id
      JOIN role_permissions rp ON rp.role_id = m.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE m.user_id = auth.uid() AND m.company_id = p_company AND m.active
       AND c.status IN ('trial', 'active') AND p.code = p_perm)
$$;

CREATE OR REPLACE FUNCTION ps_role(p_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.code FROM memberships m JOIN roles r ON r.id = m.role_id
   WHERE m.user_id = auth.uid() AND m.company_id = p_company AND m.active LIMIT 1
$$;

CREATE OR REPLACE FUNCTION ps_my_employee(p_company uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() AND company_id = p_company AND status = 'active' LIMIT 1
$$;

-- Pode ver/gerir um colaborador? (o próprio; ou com permissão — supervisores só a equipa)
CREATE OR REPLACE FUNCTION ps_can_employee(p_company uuid, p_employee uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ps_has_perm(p_company, p_perm) AND (
    COALESCE(ps_role(p_company), '') <> 'supervisor'
    OR EXISTS (SELECT 1 FROM employees e JOIN departments d ON d.id = e.department_id
                WHERE e.id = p_employee AND d.manager_user_id = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION ps_is_self_employee(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM employees WHERE id = p_employee AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION ps_require(p_ok boolean, p_message text DEFAULT 'Sem permissão para esta operação.')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.' USING ERRCODE = '28000'; END IF;
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION '%', p_message USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION ps_company_tz(p_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT timezone FROM companies WHERE id = p_company), 'Africa/Maputo')
$$;

CREATE OR REPLACE FUNCTION ps_audit_log(p_company uuid, p_action text, p_entity text, p_entity_id text, p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
  VALUES (p_company, auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

CREATE OR REPLACE FUNCTION ps_notify(p_company uuid, p_users uuid[], p_kind text, p_title text, p_body text, p_link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO notifications (company_id, user_id, kind, title, body, link)
  SELECT p_company, u, p_kind, p_title, p_body, p_link FROM unnest(p_users) AS u WHERE u IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION ps_notify_roles(p_company uuid, p_roles text[], p_kind text, p_title text, p_body text, p_link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO notifications (company_id, user_id, kind, title, body, link)
  SELECT DISTINCT p_company, m.user_id, p_kind, p_title, p_body, p_link
    FROM memberships m JOIN roles r ON r.id = m.role_id
   WHERE m.company_id = p_company AND m.active AND r.code = ANY (p_roles);
$$;

-- ---------------------------------------------------------------------
-- 3. Auditoria automática das alterações feitas pelo site
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;  -- tarefas internas não geram ruído
  IF TG_TABLE_NAME = 'companies' THEN v_company := COALESCE(NEW.id, OLD.id);
  ELSE v_company := COALESCE(v_new ->> 'company_id', v_old ->> 'company_id')::uuid; END IF;
  INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
  VALUES (v_company, auth.uid(), TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
          COALESCE(v_new ->> 'id', v_old ->> 'id'), v_old, v_new);
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','branches','departments','employees','salary_agreements','employee_components',
    'payroll_components','work_locations','attendance_stations','work_schedules','holidays','shift_assignments',
    'subscription_plans','subscriptions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ps_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER ps_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ps_audit_trigger()', t);
  END LOOP;
END $$;

-- Coordenadas do local: o site envia latitude/longitude e a base calcula a geografia.
CREATE OR REPLACE FUNCTION ps_location_geo() RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions, pg_temp AS $$
BEGIN
  NEW.center := ST_SetSRID(ST_MakePoint(NEW.center_lng::float8, NEW.center_lat::float8), 4326)::geography;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ps_location_geo ON work_locations;
CREATE TRIGGER ps_location_geo BEFORE INSERT OR UPDATE OF center_lat, center_lng ON work_locations
  FOR EACH ROW EXECUTE FUNCTION ps_location_geo();

-- Colaborador desligado/terminado perde o acesso.
CREATE OR REPLACE FUNCTION ps_employee_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE memberships SET active = (NEW.status = 'active') WHERE user_id = NEW.user_id AND company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ps_employee_status ON employees;
CREATE TRIGGER ps_employee_status AFTER UPDATE OF status ON employees FOR EACH ROW EXECUTE FUNCTION ps_employee_status();

-- ---------------------------------------------------------------------
-- 4. Regras de acesso (RLS) e permissões da API
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'ps\_%' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Tabelas de referência
GRANT SELECT ON roles, permissions, role_permissions TO authenticated;
CREATE POLICY ps_read ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY ps_read ON permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY ps_read ON role_permissions FOR SELECT TO authenticated USING (true);

GRANT SELECT ON subscription_plans TO anon, authenticated;
GRANT INSERT, UPDATE ON subscription_plans TO authenticated;
CREATE POLICY ps_read ON subscription_plans FOR SELECT TO anon, authenticated USING (active OR ps_is_platform_admin());
CREATE POLICY ps_admin_ins ON subscription_plans FOR INSERT TO authenticated WITH CHECK (ps_is_platform_admin());
CREATE POLICY ps_admin_upd ON subscription_plans FOR UPDATE TO authenticated USING (ps_is_platform_admin());

GRANT SELECT ON payroll_rule_versions TO authenticated;
CREATE POLICY ps_read ON payroll_rule_versions FOR SELECT TO authenticated
  USING (company_id IS NULL OR ps_has_perm(company_id, 'payroll.view'));

-- Utilizadores (sem colunas sensíveis)
REVOKE ALL ON users FROM authenticated;
GRANT SELECT (id, email, name, status, is_platform_admin, last_login_at, created_at) ON users TO authenticated;
GRANT UPDATE (name) ON users TO authenticated;
CREATE POLICY ps_read ON users FOR SELECT TO authenticated USING (
  id = auth.uid() OR ps_is_platform_admin()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id
               AND (ps_has_perm(m.company_id, 'employees.view') OR ps_has_perm(m.company_id, 'users.manage')
                    OR ps_has_perm(m.company_id, 'payroll.view') OR ps_has_perm(m.company_id, 'audit.view'))));
CREATE POLICY ps_self_upd ON users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

GRANT SELECT ON memberships TO authenticated;
CREATE POLICY ps_read ON memberships FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR ps_is_platform_admin() OR ps_has_perm(company_id, 'employees.view') OR ps_has_perm(company_id, 'users.manage'));

-- Empresas
GRANT SELECT ON companies TO authenticated;
GRANT UPDATE (name, legal_name, nuit, email, phone, address, settings, updated_at) ON companies TO authenticated;
CREATE POLICY ps_read ON companies FOR SELECT TO authenticated USING (ps_is_member(id) OR ps_is_platform_admin());
CREATE POLICY ps_upd ON companies FOR UPDATE TO authenticated
  USING (ps_has_perm(id, 'company.settings.manage')) WITH CHECK (ps_has_perm(id, 'company.settings.manage'));

GRANT SELECT ON subscriptions, billing_invoices TO authenticated;
CREATE POLICY ps_read ON subscriptions FOR SELECT TO authenticated
  USING (ps_is_platform_admin() OR ps_has_perm(company_id, 'company.settings.manage'));
CREATE POLICY ps_read ON billing_invoices FOR SELECT TO authenticated
  USING (ps_is_platform_admin() OR ps_has_perm(company_id, 'company.settings.manage'));

GRANT SELECT ON company_requests TO authenticated;
CREATE POLICY ps_read ON company_requests FOR SELECT TO authenticated USING (ps_is_platform_admin());

-- Estrutura da empresa: leitura para membros, escrita com permissão
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['branches', 'org.manage'],
    ARRAY['departments', 'org.manage'],
    ARRAY['work_locations', 'locations.manage'],
    ARRAY['attendance_stations', 'locations.manage'],
    ARRAY['work_schedules', 'schedules.manage'],
    ARRAY['holidays', 'schedules.manage']];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', spec[1]);
    EXECUTE format('CREATE POLICY ps_read ON %I FOR SELECT TO authenticated USING (ps_is_member(company_id))', spec[1]);
    EXECUTE format('CREATE POLICY ps_ins ON %I FOR INSERT TO authenticated WITH CHECK (ps_has_perm(company_id, %L))', spec[1], spec[2]);
    EXECUTE format('CREATE POLICY ps_upd ON %I FOR UPDATE TO authenticated USING (ps_has_perm(company_id, %L)) WITH CHECK (ps_has_perm(company_id, %L))', spec[1], spec[2], spec[2]);
    EXECUTE format('CREATE POLICY ps_del ON %I FOR DELETE TO authenticated USING (ps_has_perm(company_id, %L))', spec[1], spec[2]);
  END LOOP;
END $$;
-- Colunas protegidas: o token do QR fixo nunca é lido nem escrito pela API; o centro do local é calculado.
REVOKE SELECT, INSERT, UPDATE ON attendance_stations FROM authenticated;
GRANT SELECT (id, company_id, location_id, name, qr_mode, rotation_seconds, active, last_seen_at, created_at) ON attendance_stations TO authenticated;
GRANT INSERT (id, company_id, location_id, name, qr_mode, rotation_seconds, active) ON attendance_stations TO authenticated;
GRANT UPDATE (location_id, name, qr_mode, rotation_seconds, active) ON attendance_stations TO authenticated;
REVOKE INSERT, UPDATE ON work_locations FROM authenticated;
GRANT INSERT (id, company_id, branch_id, name, center_lat, center_lng, radius_m, max_accuracy_m, active) ON work_locations TO authenticated;
GRANT UPDATE (branch_id, name, center_lat, center_lng, radius_m, max_accuracy_m, active) ON work_locations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_rules TO authenticated;
CREATE POLICY ps_read ON schedule_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM work_schedules s WHERE s.id = schedule_id AND ps_is_member(s.company_id)));
CREATE POLICY ps_write ON schedule_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM work_schedules s WHERE s.id = schedule_id AND ps_has_perm(s.company_id, 'schedules.manage')))
  WITH CHECK (EXISTS (SELECT 1 FROM work_schedules s WHERE s.id = schedule_id AND ps_has_perm(s.company_id, 'schedules.manage')));

GRANT SELECT, INSERT, UPDATE, DELETE ON shift_assignments TO authenticated;
CREATE POLICY ps_read ON shift_assignments FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'employees.view'));
CREATE POLICY ps_write ON shift_assignments FOR ALL TO authenticated
  USING (ps_has_perm(company_id, 'schedules.manage') OR ps_has_perm(company_id, 'employees.manage'))
  WITH CHECK (ps_has_perm(company_id, 'schedules.manage') OR ps_has_perm(company_id, 'employees.manage'));

-- Colaboradores
GRANT SELECT ON employees TO authenticated;
GRANT UPDATE (full_name, email, phone, job_title, department_id, branch_id, hire_date, status, nuit, bank_account) ON employees TO authenticated;
CREATE POLICY ps_read ON employees FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR ps_can_employee(company_id, id, 'employees.view'));
CREATE POLICY ps_upd ON employees FOR UPDATE TO authenticated
  USING (ps_has_perm(company_id, 'employees.manage')) WITH CHECK (ps_has_perm(company_id, 'employees.manage'));

GRANT SELECT, INSERT, UPDATE ON employment_contracts TO authenticated;
CREATE POLICY ps_read ON employment_contracts FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'employees.view'));
CREATE POLICY ps_write ON employment_contracts FOR ALL TO authenticated
  USING (ps_has_perm(company_id, 'employees.manage')) WITH CHECK (ps_has_perm(company_id, 'employees.manage'));

-- Dados salariais: só quem tem acesso a salários (e o próprio)
GRANT SELECT ON salary_agreements, employee_components, payroll_components TO authenticated;
GRANT INSERT ON employee_components TO authenticated;
GRANT INSERT, UPDATE ON payroll_components TO authenticated;
GRANT UPDATE (effective_to, note) ON employee_components TO authenticated;
CREATE POLICY ps_read ON salary_agreements FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'employees.salary.view'));
CREATE POLICY ps_read ON employee_components FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'employees.salary.view'));
CREATE POLICY ps_ins ON employee_components FOR INSERT TO authenticated
  WITH CHECK (ps_has_perm(company_id, 'employees.salary.view') AND ps_has_perm(company_id, 'payroll.view'));
CREATE POLICY ps_upd ON employee_components FOR UPDATE TO authenticated
  USING (ps_has_perm(company_id, 'employees.salary.view') AND ps_has_perm(company_id, 'payroll.view'));
CREATE POLICY ps_read ON payroll_components FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view') OR ps_has_perm(company_id, 'employees.salary.view'));
CREATE POLICY ps_ins ON payroll_components FOR INSERT TO authenticated WITH CHECK (ps_has_perm(company_id, 'payroll.prepare'));
CREATE POLICY ps_upd ON payroll_components FOR UPDATE TO authenticated USING (ps_has_perm(company_id, 'payroll.prepare'));

-- Assiduidade (escrita apenas pelas funções)
GRANT SELECT ON attendance_events, attendance_validations, attendance_daily, attendance_adjustments TO authenticated;
CREATE POLICY ps_read ON attendance_events FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'attendance.view'));
CREATE POLICY ps_read ON attendance_validations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM attendance_events e WHERE e.id = event_id
                  AND (ps_is_self_employee(e.employee_id) OR ps_can_employee(e.company_id, e.employee_id, 'attendance.view'))));
CREATE POLICY ps_read ON attendance_daily FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'attendance.view'));
CREATE POLICY ps_read ON attendance_adjustments FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'attendance.view'));

REVOKE ALL ON trusted_devices FROM authenticated;
GRANT SELECT ON trusted_devices TO authenticated;
GRANT UPDATE (label) ON trusted_devices TO authenticated;
CREATE POLICY ps_read ON trusted_devices FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'attendance.manage'));
CREATE POLICY ps_upd ON trusted_devices FOR UPDATE TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'attendance.manage'));

-- Justificações (criação e decisão pelas funções)
GRANT SELECT ON absence_requests, absence_documents, approval_steps TO authenticated;
CREATE POLICY ps_read ON absence_requests FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'absence.decide')
         OR ps_can_employee(company_id, employee_id, 'absence.decide.team'));
CREATE POLICY ps_read ON absence_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM absence_requests r WHERE r.id = request_id));
CREATE POLICY ps_read ON approval_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM absence_requests r WHERE r.id = request_id));

-- Salários
GRANT SELECT ON payroll_periods, payroll_runs, payroll_items, payroll_lines, payslips, payslip_acknowledgements, salary_payments TO authenticated;
CREATE POLICY ps_read ON payroll_periods FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view')
         OR EXISTS (SELECT 1 FROM payroll_runs r JOIN payslips s ON s.run_id = r.id
                     WHERE r.period_id = payroll_periods.id AND ps_is_self_employee(s.employee_id)));
CREATE POLICY ps_read ON payroll_runs FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view')
         OR EXISTS (SELECT 1 FROM payslips s WHERE s.run_id = payroll_runs.id AND ps_is_self_employee(s.employee_id)));
CREATE POLICY ps_read ON payroll_items FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view')
         OR EXISTS (SELECT 1 FROM payslips s WHERE s.payroll_item_id = payroll_items.id AND ps_is_self_employee(s.employee_id)));
CREATE POLICY ps_read ON payroll_lines FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view')
         OR EXISTS (SELECT 1 FROM payslips s WHERE s.payroll_item_id = payroll_lines.payroll_item_id AND ps_is_self_employee(s.employee_id)));
CREATE POLICY ps_read ON payslips FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'payroll.view'));
CREATE POLICY ps_read ON payslip_acknowledgements FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_has_perm(company_id, 'payroll.view'));
CREATE POLICY ps_read ON salary_payments FOR SELECT TO authenticated
  USING (ps_has_perm(company_id, 'payroll.view')
         OR EXISTS (SELECT 1 FROM payslips s WHERE s.payroll_item_id = salary_payments.payroll_item_id AND ps_is_self_employee(s.employee_id)));

-- Notificações, auditoria, IA
GRANT SELECT ON notifications TO authenticated;
GRANT UPDATE (read_at) ON notifications TO authenticated;
CREATE POLICY ps_read ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY ps_upd ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT ON audit_logs TO authenticated;
CREATE POLICY ps_read ON audit_logs FOR SELECT TO authenticated
  USING (ps_is_platform_admin() OR (company_id IS NOT NULL AND ps_has_perm(company_id, 'audit.view')));

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations TO authenticated;
CREATE POLICY ps_own ON ai_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND ps_has_perm(company_id, 'ai.use'));
GRANT SELECT ON ai_tool_executions TO authenticated;
CREATE POLICY ps_read ON ai_tool_executions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 5. Sessão: quem sou eu e onde trabalho
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_me() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user users;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = auth.uid();
  IF v_user.id IS NULL THEN RETURN NULL; END IF;
  IF v_user.status = 'disabled' THEN RAISE EXCEPTION 'Conta desactivada. Contacte o administrador.' USING ERRCODE = '42501'; END IF;
  IF v_user.last_login_at IS NULL OR v_user.last_login_at < now() - interval '10 minutes' THEN
    UPDATE users SET last_login_at = now() WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object(
    'id', v_user.id, 'login', v_user.email, 'name', v_user.name, 'isPlatformAdmin', v_user.is_platform_admin,
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'companyId', c.id, 'companyName', c.name, 'companyStatus', c.status, 'timezone', c.timezone,
        'currency', c.currency, 'settings', c.settings, 'role', r.code, 'roleName', r.name,
        'employeeId', (SELECT e.id FROM employees e WHERE e.company_id = c.id AND e.user_id = v_user.id LIMIT 1),
        'permissions', (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]') FROM role_permissions rp
                          JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id),
        'teamDepartments', (SELECT COALESCE(jsonb_agg(d.id), '[]') FROM departments d
                              WHERE d.company_id = c.id AND d.manager_user_id = v_user.id)
      ) ORDER BY c.name)
      FROM memberships m JOIN companies c ON c.id = m.company_id JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = v_user.id AND m.active AND c.status IN ('trial', 'active')), '[]'::jsonb)
  );
END $$;

-- ---------------------------------------------------------------------
-- 6. Home pública: pedido de conta para a empresa
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_submit_company_request(
  p_company_name text, p_contact_name text, p_email text, p_phone text DEFAULT NULL, p_nuit text DEFAULT NULL,
  p_city text DEFAULT NULL, p_employees integer DEFAULT NULL, p_plan_code text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_key text; v_count int;
BEGIN
  IF length(trim(COALESCE(p_company_name, ''))) < 2 OR length(trim(COALESCE(p_contact_name, ''))) < 3 THEN
    RAISE EXCEPTION 'Indique o nome da empresa e o nome do responsável.' USING ERRCODE = '22023';
  END IF;
  IF p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Indique um email válido.' USING ERRCODE = '22023';
  END IF;
  -- Limite simples contra abuso: 3 pedidos por email por dia e 300 por dia no total.
  v_key := 'req:' || lower(trim(p_email)) || ':' || current_date;
  INSERT INTO rate_limits (key, window_start, count) VALUES (v_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_count;
  IF v_count > 3 THEN RAISE EXCEPTION 'Já recebemos o seu pedido. Aguarde o nosso contacto.' USING ERRCODE = '54000'; END IF;
  INSERT INTO rate_limits (key, window_start, count) VALUES ('req:all:' || current_date, now(), 1)
  ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_count;
  IF v_count > 300 THEN RAISE EXCEPTION 'Muitos pedidos hoje. Tente amanhã.' USING ERRCODE = '54000'; END IF;

  INSERT INTO company_requests (company_name, nuit, contact_name, email, phone, city, employees_estimate, plan_id, message)
  VALUES (left(trim(p_company_name), 160), NULLIF(left(trim(p_nuit), 20), ''), left(trim(p_contact_name), 120),
          lower(trim(p_email)), NULLIF(left(trim(p_phone), 30), ''), NULLIF(left(trim(p_city), 80), ''),
          CASE WHEN p_employees BETWEEN 1 AND 100000 THEN p_employees END,
          (SELECT id FROM subscription_plans WHERE code = p_plan_code AND active),
          NULLIF(left(trim(p_message), 1000), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 7. Super Admin: empresas, pedidos e visão geral
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_admin_create_company(
  p_name text, p_plan_code text, p_owner_name text, p_owner_login text, p_owner_password text,
  p_nuit text DEFAULT NULL, p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_trial_days integer DEFAULT 30,
  p_request uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid; v_owner uuid; v_plan uuid; v_role uuid;
BEGIN
  PERFORM ps_require(ps_is_platform_admin(), 'Apenas o Super Admin pode criar empresas.');
  IF length(trim(COALESCE(p_name, ''))) < 2 THEN RAISE EXCEPTION 'Indique o nome da empresa.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_owner_login, ''))) < 3 OR lower(trim(p_owner_login)) !~ '^[a-z0-9._@+-]+$' THEN
    RAISE EXCEPTION 'Acesso do responsável inválido: use letras, números, ponto, hífen ou um email.' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(p_owner_password, '')) < 8 THEN
    RAISE EXCEPTION 'A palavra-passe do responsável deve ter pelo menos 8 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = lower(trim(p_owner_login))) THEN
    RAISE EXCEPTION 'O acesso "%" já existe. Escolha outro utilizador para o responsável.', lower(trim(p_owner_login)) USING ERRCODE = '23505';
  END IF;
  IF p_request IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_requests WHERE id = p_request AND status = 'pending') THEN
    RAISE EXCEPTION 'Este pedido já foi tratado.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_plan FROM subscription_plans WHERE code = p_plan_code;
  IF v_plan IS NULL THEN SELECT id INTO v_plan FROM subscription_plans WHERE active ORDER BY price_monthly LIMIT 1; END IF;

  INSERT INTO companies (name, nuit, email, phone, status)
  VALUES (trim(p_name), NULLIF(trim(p_nuit), ''), NULLIF(lower(trim(p_email)), ''), NULLIF(trim(p_phone), ''),
          CASE WHEN COALESCE(p_trial_days, 0) > 0 THEN 'trial' ELSE 'active' END::company_status)
  RETURNING id INTO v_company;

  INSERT INTO users (email, name, password_hash) VALUES (lower(trim(p_owner_login)), trim(p_owner_name), 'supabase-auth')
  RETURNING id INTO v_owner;
  PERFORM ps_auth_upsert(v_owner, p_owner_login, p_owner_password);
  SELECT id INTO v_role FROM roles WHERE code = 'owner';
  INSERT INTO memberships (user_id, company_id, role_id) VALUES (v_owner, v_company, v_role)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role_id = EXCLUDED.role_id, active = true;

  INSERT INTO subscriptions (company_id, plan_id, status, current_period_start, current_period_end)
  VALUES (v_company, v_plan, CASE WHEN COALESCE(p_trial_days, 0) > 0 THEN 'trialing' ELSE 'active' END::subscription_status,
          current_date, current_date + GREATEST(COALESCE(p_trial_days, 0), 30));

  -- Horário base e local para a empresa começar logo.
  WITH s AS (INSERT INTO work_schedules (company_id, name) VALUES (v_company, 'Horário normal (08:00–17:00)') RETURNING id)
  INSERT INTO schedule_rules (schedule_id, weekday, start_time, end_time, break_minutes)
  SELECT s.id, d, '08:00', '17:00', 60 FROM s, generate_series(1, 5) d;

  IF p_request IS NOT NULL THEN
    UPDATE company_requests SET status = 'approved', company_id = v_company, decided_by = auth.uid(), decided_at = now()
     WHERE id = p_request AND status = 'pending';
  END IF;
  PERFORM ps_audit_log(v_company, 'company.provisioned', 'company', v_company::text, NULL,
                       jsonb_build_object('name', p_name, 'owner', lower(trim(p_owner_login)), 'request', p_request));
  RETURN v_company;
END $$;

CREATE OR REPLACE FUNCTION ps_admin_reject_request(p_request uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_is_platform_admin());
  UPDATE company_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         message = COALESCE(message, '') || E'\n[Recusado] ' || COALESCE(p_reason, '')
   WHERE id = p_request AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido já decidido ou inexistente.' USING ERRCODE = 'P0002'; END IF;
  PERFORM ps_audit_log(NULL, 'company_request.rejected', 'company_request', p_request::text, NULL, jsonb_build_object('reason', p_reason));
END $$;

CREATE OR REPLACE FUNCTION ps_admin_set_company_status(p_company uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_is_platform_admin());
  IF p_status NOT IN ('trial', 'active', 'suspended', 'cancelled') THEN RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE companies SET status = p_status::company_status, updated_at = now() WHERE id = p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE = 'P0002'; END IF;
  UPDATE subscriptions SET status = CASE p_status WHEN 'trial' THEN 'trialing' WHEN 'active' THEN 'active'
                                                  WHEN 'suspended' THEN 'past_due' ELSE 'cancelled' END::subscription_status
   WHERE id = (SELECT id FROM subscriptions WHERE company_id = p_company ORDER BY created_at DESC LIMIT 1);
  PERFORM ps_audit_log(p_company, 'company.status_changed', 'company', p_company::text, NULL, jsonb_build_object('status', p_status));
END $$;

CREATE OR REPLACE FUNCTION ps_admin_set_plan(p_company uuid, p_plan_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan uuid; v_sub uuid;
BEGIN
  PERFORM ps_require(ps_is_platform_admin());
  SELECT id INTO v_plan FROM subscription_plans WHERE code = p_plan_code;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'Plano inexistente.' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO v_sub FROM subscriptions WHERE company_id = p_company ORDER BY created_at DESC LIMIT 1;
  IF v_sub IS NULL THEN
    INSERT INTO subscriptions (company_id, plan_id, status, current_period_start, current_period_end)
    VALUES (p_company, v_plan, 'active', current_date, current_date + 30);
  ELSE
    UPDATE subscriptions SET plan_id = v_plan WHERE id = v_sub;
  END IF;
  PERFORM ps_audit_log(p_company, 'subscription.plan_changed', 'company', p_company::text, NULL, jsonb_build_object('plan', p_plan_code));
END $$;

CREATE OR REPLACE FUNCTION ps_admin_reset_owner_password(p_company uuid, p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user users;
BEGIN
  PERFORM ps_require(ps_is_platform_admin());
  SELECT u.* INTO v_user FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
   WHERE m.company_id = p_company AND r.code = 'owner' ORDER BY m.created_at LIMIT 1;
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Esta empresa não tem proprietário.' USING ERRCODE = 'P0002'; END IF;
  PERFORM ps_auth_upsert(v_user.id, v_user.email, p_password);
  PERFORM ps_audit_log(p_company, 'user.password_reset', 'user', v_user.id::text, NULL, NULL);
  RETURN v_user.email;
END $$;

CREATE OR REPLACE FUNCTION ps_admin_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM ps_require(ps_is_platform_admin());
  SELECT jsonb_build_object(
    'companies', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]') FROM (
        SELECT c.id, c.name, c.nuit, c.email, c.phone, c.status, c.created_at,
               (SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.status = 'active') AS employees,
               p.name AS plan, p.code AS plan_code, p.price_monthly, s.status AS subscription_status, s.current_period_end,
               (SELECT u.email FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
                 WHERE m.company_id = c.id AND r.code = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_login,
               (SELECT max(ev.occurred_at) FROM attendance_events ev WHERE ev.company_id = c.id) AS last_activity
          FROM companies c
          LEFT JOIN LATERAL (SELECT * FROM subscriptions s WHERE s.company_id = c.id ORDER BY s.created_at DESC LIMIT 1) s ON true
          LEFT JOIN subscription_plans p ON p.id = s.plan_id) x),
    'requests', (SELECT COALESCE(jsonb_agg(to_jsonb(q) || jsonb_build_object('plan', p.name) ORDER BY q.created_at DESC), '[]')
                   FROM company_requests q LEFT JOIN subscription_plans p ON p.id = q.plan_id),
    'plans', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.price_monthly), '[]') FROM subscription_plans p),
    'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d::date, 'events', COALESCE(n.c, 0), 'companies', COALESCE(n.k, 0)) ORDER BY d), '[]')
                   FROM generate_series(current_date - 29, current_date, interval '1 day') d
                   LEFT JOIN (SELECT work_date, count(*) c, count(DISTINCT company_id) k FROM attendance_events
                               WHERE work_date >= current_date - 29 GROUP BY work_date) n ON n.work_date = d::date),
    'growth', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                        'companies', (SELECT count(*) FROM companies c WHERE c.created_at < m + interval '1 month'),
                        'employees', (SELECT count(*) FROM employees e WHERE e.created_at < m + interval '1 month' AND e.status = 'active')) ORDER BY m), '[]')
                 FROM generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m)
  ) INTO v;
  RETURN v;
END $$;

-- ---------------------------------------------------------------------
-- 8. Empresa: colaboradores e credenciais
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_set_access(p_employee uuid, p_login text, p_password text, p_role text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_user uuid; v_role uuid; v_role_code text := NULLIF(p_role, ''); v_login text := lower(trim(p_login));
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  -- Sem papel indicado: mantém o actual (ou colaborador, se ainda não tem acesso).
  IF v_role_code IS NULL THEN
    SELECT r.code INTO v_role_code FROM memberships m JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = v_emp.user_id AND m.company_id = v_emp.company_id;
    v_role_code := COALESCE(v_role_code, 'employee');
  END IF;
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(v_emp.company_id, 'employees.manage'));
  IF v_role_code NOT IN ('employee', 'supervisor', 'hr', 'finance', 'admin', 'owner') THEN
    RAISE EXCEPTION 'Papel inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_role_code <> 'employee' THEN
    PERFORM ps_require(ps_has_perm(v_emp.company_id, 'users.manage'), 'Só quem gere contas pode atribuir este papel.');
  END IF;
  IF v_role_code = 'owner' THEN
    PERFORM ps_require(ps_role(v_emp.company_id) = 'owner', 'Só o proprietário pode criar outro proprietário.');
  END IF;
  IF length(COALESCE(v_login, '')) < 3 OR v_login !~ '^[a-z0-9._@+-]+$' THEN
    RAISE EXCEPTION 'Acesso inválido: use letras, números, ponto, hífen ou um email.' USING ERRCODE = '22023';
  END IF;

  v_user := v_emp.user_id;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM users WHERE email = v_login;
    IF v_user IS NOT NULL AND EXISTS (SELECT 1 FROM employees WHERE user_id = v_user AND company_id = v_emp.company_id) THEN
      RAISE EXCEPTION 'Esse acesso já está atribuído a outro colaborador.' USING ERRCODE = '23505';
    END IF;
    IF v_user IS NOT NULL THEN
      RAISE EXCEPTION 'O acesso "%" já existe. Escolha outro.', v_login USING ERRCODE = '23505';
    END IF;
    IF p_password IS NULL OR length(p_password) < 8 THEN
      RAISE EXCEPTION 'Defina uma palavra-passe com pelo menos 8 caracteres.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO users (email, name, password_hash) VALUES (v_login, v_emp.full_name, 'supabase-auth') RETURNING id INTO v_user;
    UPDATE employees SET user_id = v_user WHERE id = v_emp.id;
  ELSE
    IF EXISTS (SELECT 1 FROM users WHERE email = v_login AND id <> v_user) THEN
      RAISE EXCEPTION 'O acesso "%" já existe. Escolha outro.', v_login USING ERRCODE = '23505';
    END IF;
    UPDATE users SET email = v_login, name = v_emp.full_name, status = 'active' WHERE id = v_user;
  END IF;
  PERFORM ps_auth_upsert(v_user, v_login, NULLIF(p_password, ''));

  SELECT id INTO v_role FROM roles WHERE code = v_role_code;
  INSERT INTO memberships (user_id, company_id, role_id, active) VALUES (v_user, v_emp.company_id, v_role, v_emp.status = 'active')
  ON CONFLICT (user_id, company_id) DO UPDATE SET role_id = EXCLUDED.role_id, active = EXCLUDED.active;
  PERFORM ps_audit_log(v_emp.company_id, 'employee.access_set', 'employee', v_emp.id::text, NULL,
                       jsonb_build_object('login', v_login, 'role', v_role_code, 'passwordChanged', p_password IS NOT NULL AND p_password <> ''));
  RETURN v_user;
END $$;

CREATE OR REPLACE FUNCTION ps_create_employee(p_company uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_hire date := COALESCE(NULLIF(p ->> 'hireDate', '')::date, current_date);
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'employees.manage'));
  IF length(trim(COALESCE(p ->> 'fullName', ''))) < 3 THEN RAISE EXCEPTION 'Indique o nome completo.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p ->> 'employeeCode', ''))) < 1 THEN RAISE EXCEPTION 'Indique o número do colaborador.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM employees WHERE company_id = p_company AND employee_code = trim(p ->> 'employeeCode')) THEN
    RAISE EXCEPTION 'Já existe um colaborador com esse número.' USING ERRCODE = '23505';
  END IF;
  IF NULLIF(p ->> 'salary', '') IS NOT NULL AND NOT ps_has_perm(p_company, 'employees.salary.view') THEN
    RAISE EXCEPTION 'Sem permissão para definir salários.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO employees (company_id, employee_code, full_name, email, phone, job_title, department_id, branch_id, hire_date, nuit)
  VALUES (p_company, trim(p ->> 'employeeCode'), trim(p ->> 'fullName'), NULLIF(lower(trim(p ->> 'email')), ''),
          NULLIF(trim(p ->> 'phone'), ''), NULLIF(trim(p ->> 'jobTitle'), ''),
          (SELECT id FROM departments WHERE id = NULLIF(p ->> 'departmentId', '')::uuid AND company_id = p_company),
          (SELECT id FROM branches WHERE id = NULLIF(p ->> 'branchId', '')::uuid AND company_id = p_company),
          v_hire, NULLIF(trim(p ->> 'nuit'), ''))
  RETURNING id INTO v_id;

  INSERT INTO employment_contracts (company_id, employee_id, type, start_date, weekly_hours)
  VALUES (p_company, v_id, COALESCE(NULLIF(p ->> 'contractType', ''), 'indeterminado')::contract_type, v_hire,
          COALESCE(NULLIF(p ->> 'weeklyHours', '')::int, 40));
  IF NULLIF(p ->> 'scheduleId', '') IS NOT NULL THEN
    INSERT INTO shift_assignments (company_id, employee_id, schedule_id, valid_from)
    SELECT p_company, v_id, s.id, v_hire FROM work_schedules s WHERE s.id = (p ->> 'scheduleId')::uuid AND s.company_id = p_company;
  END IF;
  IF NULLIF(p ->> 'salary', '') IS NOT NULL THEN
    INSERT INTO salary_agreements (company_id, employee_id, amount, effective_from, created_by)
    VALUES (p_company, v_id, (p ->> 'salary')::numeric(14, 2), v_hire, auth.uid());
  END IF;
  IF NULLIF(p ->> 'login', '') IS NOT NULL THEN
    PERFORM ps_set_access(v_id, p ->> 'login', p ->> 'password', COALESCE(p ->> 'role', 'employee'));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_remove_access(p_employee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(v_emp.company_id, 'employees.manage'));
  IF v_emp.user_id IS NULL THEN RETURN; END IF;
  IF v_emp.user_id = auth.uid() THEN RAISE EXCEPTION 'Não pode remover o seu próprio acesso.' USING ERRCODE = '42501'; END IF;
  UPDATE memberships SET active = false WHERE user_id = v_emp.user_id AND company_id = v_emp.company_id;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = v_emp.user_id AND active) THEN
    PERFORM ps_auth_disable(v_emp.user_id, true);
  END IF;
  PERFORM ps_audit_log(v_emp.company_id, 'employee.access_removed', 'employee', v_emp.id::text, NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION ps_add_salary(p_employee uuid, p_amount numeric, p_from date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_id uuid;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(v_emp.company_id, 'employees.salary.view')
                     AND ps_has_perm(v_emp.company_id, 'employees.manage'));
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE salary_agreements SET effective_to = p_from - 1
   WHERE employee_id = v_emp.id AND effective_to IS NULL AND effective_from < p_from;
  INSERT INTO salary_agreements (company_id, employee_id, amount, effective_from, created_by)
  VALUES (v_emp.company_id, v_emp.id, round(p_amount, 2), p_from, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_assign_schedule(p_employee uuid, p_schedule uuid, p_from date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  PERFORM ps_require(v_emp.id IS NOT NULL AND (ps_has_perm(v_emp.company_id, 'schedules.manage') OR ps_has_perm(v_emp.company_id, 'employees.manage')));
  PERFORM 1 FROM work_schedules WHERE id = p_schedule AND company_id = v_emp.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Horário inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE shift_assignments SET valid_to = p_from - 1
   WHERE employee_id = v_emp.id AND (valid_to IS NULL OR valid_to >= p_from) AND valid_from < p_from;
  DELETE FROM shift_assignments WHERE employee_id = v_emp.id AND valid_from >= p_from;
  INSERT INTO shift_assignments (company_id, employee_id, schedule_id, valid_from) VALUES (v_emp.company_id, v_emp.id, p_schedule, p_from);
END $$;

-- ---------------------------------------------------------------------
-- 9. Assiduidade: consolidação diária
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_recompute_daily(p_employee uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_emp employees; v_existing attendance_daily; v_tz text; v_sched work_schedules; v_rule schedule_rules;
  v_holiday boolean; v_start timestamptz; v_end timestamptz; v_break_plan int := 0; v_tol int := 0;
  e record; v_worked int := 0; v_breaks int := 0; v_open_in timestamptz; v_open_break timestamptz;
  v_first_in timestamptz; v_last_out timestamptz; v_last_type attendance_event_type; v_count int := 0;
  v_review boolean := false; v_late int := 0; v_late_beyond boolean := false; v_overtime int := 0;
  v_status daily_status; v_day_over boolean; v_keep daily_status;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  IF v_emp.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_existing FROM attendance_daily WHERE employee_id = p_employee AND work_date = p_date;
  IF v_existing.locked THEN RETURN; END IF;
  v_tz := ps_company_tz(v_emp.company_id);

  SELECT s.* INTO v_sched FROM shift_assignments a JOIN work_schedules s ON s.id = a.schedule_id
   WHERE a.employee_id = p_employee AND a.valid_from <= p_date AND (a.valid_to IS NULL OR a.valid_to >= p_date)
   ORDER BY a.valid_from DESC LIMIT 1;
  IF v_sched.id IS NOT NULL THEN
    SELECT * INTO v_rule FROM schedule_rules WHERE schedule_id = v_sched.id AND weekday = extract(isodow FROM p_date)::int LIMIT 1;
    v_tol := v_sched.tolerance_minutes;
    v_tz := COALESCE(v_sched.timezone, v_tz);
  END IF;
  v_holiday := EXISTS (SELECT 1 FROM holidays h WHERE h.company_id = v_emp.company_id
                        AND (h.date = p_date OR (h.recurring AND to_char(h.date, 'MM-DD') = to_char(p_date, 'MM-DD'))));
  IF v_rule.id IS NOT NULL AND NOT v_holiday THEN
    v_start := (p_date + v_rule.start_time) AT TIME ZONE v_tz;
    v_end := (CASE WHEN v_rule.end_time <= v_rule.start_time THEN p_date + 1 ELSE p_date END + v_rule.end_time) AT TIME ZONE v_tz;
    v_break_plan := v_rule.break_minutes;
  END IF;

  FOR e IN SELECT type, occurred_at, status FROM attendance_events
            WHERE employee_id = p_employee AND work_date = p_date AND status <> 'rejected' ORDER BY occurred_at LOOP
    v_count := v_count + 1;
    IF e.status = 'review' THEN v_review := true; END IF;
    IF e.type = 'in' THEN
      v_open_in := e.occurred_at; v_first_in := COALESCE(v_first_in, e.occurred_at);
    ELSIF e.type = 'out' AND v_open_in IS NOT NULL THEN
      v_worked := v_worked + round(extract(epoch FROM e.occurred_at - v_open_in) / 60)::int; v_open_in := NULL; v_last_out := e.occurred_at;
    ELSIF e.type = 'break_start' THEN
      v_open_break := e.occurred_at;
    ELSIF e.type = 'break_end' AND v_open_break IS NOT NULL THEN
      v_breaks := v_breaks + round(extract(epoch FROM e.occurred_at - v_open_break) / 60)::int; v_open_break := NULL;
    END IF;
    v_last_type := e.type;
  END LOOP;
  v_worked := GREATEST(0, v_worked - v_breaks);

  IF v_first_in IS NOT NULL AND v_start IS NOT NULL THEN
    v_late := GREATEST(0, round(extract(epoch FROM v_first_in - v_start) / 60)::int);
  END IF;
  v_late_beyond := v_late > v_tol;
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_last_out IS NOT NULL THEN
    v_overtime := v_worked - (round(extract(epoch FROM v_end - v_start) / 60)::int - v_break_plan);
    IF v_overtime <= v_tol THEN v_overtime := 0; END IF;
  END IF;

  v_day_over := p_date < (now() AT TIME ZONE v_tz)::date;
  IF v_existing.status IN ('justified', 'unjustified') THEN v_keep := v_existing.status; END IF;
  IF v_count = 0 AND NOT v_day_over AND v_existing.id IS NULL THEN RETURN; END IF;

  IF v_count = 0 THEN
    v_status := CASE WHEN v_keep IS NOT NULL THEN v_keep WHEN v_holiday THEN 'holiday'
                     WHEN v_start IS NULL THEN 'day_off' ELSE 'absent_pending' END;
  ELSIF v_review THEN v_status := 'review';
  ELSIF v_last_type IN ('in', 'break_start', 'break_end') AND v_day_over THEN v_status := 'incomplete';
  ELSIF v_start IS NULL THEN v_status := 'present';
  ELSIF v_late_beyond THEN v_status := 'late';
  ELSE v_status := 'on_time';
  END IF;

  INSERT INTO attendance_daily (company_id, employee_id, work_date, schedule_id, expected_start, expected_end, first_in, last_out,
                                worked_minutes, break_minutes, late_minutes, overtime_minutes, status, updated_at)
  VALUES (v_emp.company_id, p_employee, p_date, v_sched.id, v_start, v_end, v_first_in, v_last_out, v_worked, v_breaks,
          CASE WHEN v_late_beyond THEN v_late ELSE 0 END, v_overtime, v_status, now())
  ON CONFLICT (employee_id, work_date) DO UPDATE SET
    schedule_id = EXCLUDED.schedule_id, expected_start = EXCLUDED.expected_start, expected_end = EXCLUDED.expected_end,
    first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out, worked_minutes = EXCLUDED.worked_minutes,
    break_minutes = EXCLUDED.break_minutes, late_minutes = EXCLUDED.late_minutes, overtime_minutes = EXCLUDED.overtime_minutes,
    status = EXCLUDED.status, updated_at = now();
END $$;

-- Fecho do dia (faltas pendentes, registos incompletos). Corre pelo agendador ou à mão.
CREATE OR REPLACE FUNCTION ps_close_day(p_date date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_n int := 0; v_date date; v_abs uuid;
BEGIN
  FOR r IN SELECT e.id, e.company_id, c.timezone FROM employees e JOIN companies c ON c.id = e.company_id
            WHERE e.status = 'active' AND c.status IN ('trial', 'active') LOOP
    v_date := COALESCE(p_date, (now() AT TIME ZONE r.timezone)::date - 1);
    PERFORM ps_recompute_daily(r.id, v_date);
    SELECT a.id INTO v_abs FROM absence_requests a WHERE a.employee_id = r.id AND a.status = 'approved'
       AND a.start_date <= v_date AND a.end_date >= v_date LIMIT 1;
    IF v_abs IS NOT NULL THEN
      UPDATE attendance_daily SET status = 'justified', absence_request_id = v_abs, updated_at = now()
       WHERE employee_id = r.id AND work_date = v_date AND status = 'absent_pending' AND NOT locked;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Fecho de dias anteriores da própria empresa (usado pelo painel quando não há agendador).
CREATE OR REPLACE FUNCTION ps_close_pending_days(p_company uuid, p_days integer DEFAULT 7)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; d date; v_n int := 0; v_today date;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'attendance.view'));
  v_today := (now() AT TIME ZONE ps_company_tz(p_company))::date;
  FOR r IN SELECT id FROM employees WHERE company_id = p_company AND status = 'active' LOOP
    FOR d IN SELECT generate_series(v_today - LEAST(GREATEST(p_days, 1), 31), v_today - 1, interval '1 day')::date LOOP
      PERFORM ps_recompute_daily(r.id, d);
      UPDATE attendance_daily ad SET status = 'justified', absence_request_id = a.id, updated_at = now()
        FROM absence_requests a
       WHERE ad.employee_id = r.id AND ad.work_date = d AND ad.status = 'absent_pending' AND NOT ad.locked
         AND a.employee_id = r.id AND a.status = 'approved' AND a.start_date <= d AND a.end_date >= d;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------
-- 10. QR dinâmico e marcação de ponto
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_station_qr(p_station uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text; v_ttl int; v_exp timestamptz;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'stations.display'), 'Sem permissão para abrir esta estação.');
  IF NOT v_st.active THEN RAISE EXCEPTION 'Estação inactiva.' USING ERRCODE = '22023'; END IF;
  v_ttl := GREATEST(10, LEAST(COALESCE(v_st.rotation_seconds, 30), 300));
  v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_exp := now() + make_interval(secs => v_ttl);
  INSERT INTO qr_challenges (company_id, station_id, token_hash, expires_at)
  VALUES (v_st.company_id, v_st.id, encode(digest(v_token, 'sha256'), 'hex'), v_exp);
  UPDATE attendance_stations SET last_seen_at = now() WHERE id = v_st.id;
  DELETE FROM qr_challenges WHERE station_id = v_st.id AND expires_at < now() - interval '1 hour';
  RETURN jsonb_build_object('token', v_token, 'expiresAt', v_exp, 'ttl', v_ttl, 'station', v_st.name,
                            'location', (SELECT name FROM work_locations WHERE id = v_st.location_id));
END $$;

-- QR fixo (impresso). Gera um novo e revoga o anterior.
CREATE OR REPLACE FUNCTION ps_station_static_qr(p_station uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'locations.manage'));
  v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  UPDATE attendance_stations SET qr_mode = 'static', static_token_hash = encode(digest(v_token, 'sha256'), 'hex') WHERE id = v_st.id;
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION ps_clock(
  p_token text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_idempotency text, p_device_key text DEFAULT NULL, p_requested text DEFAULT NULL,
  p_request_review boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_hash text := encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex');
  v_ch qr_challenges; v_st attendance_stations; v_loc work_locations; v_mode qr_mode;
  v_emp employees; v_company companies; v_settings jsonb; v_tz text;
  v_outside double precision; v_center double precision; v_geo geofence_result; v_geo_msg text;
  v_device device_result := 'not_required'; v_device_id uuid; v_status attendance_event_status := 'accepted';
  v_reasons text[] := '{}'; v_prior record; v_last record; v_type attendance_event_type; v_work_date date;
  v_event uuid; v_now timestamptz := now(); v_msg text; v_window int;
BEGIN
  PERFORM ps_require(true);
  IF p_idempotency IS NULL OR length(p_idempotency) < 8 THEN RAISE EXCEPTION 'Pedido inválido.' USING ERRCODE = '22023'; END IF;

  -- 1) QR: dinâmico (registado e válido) ou fixo (hash da estação).
  SELECT * INTO v_ch FROM qr_challenges WHERE token_hash = v_hash;
  IF v_ch.id IS NOT NULL THEN
    IF v_now > v_ch.expires_at + interval '10 seconds' THEN
      RAISE EXCEPTION 'O QR Code expirou. Leia novamente o código apresentado na estação.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_st FROM attendance_stations WHERE id = v_ch.station_id;
    v_mode := 'dynamic';
  ELSE
    SELECT * INTO v_st FROM attendance_stations WHERE qr_mode = 'static' AND static_token_hash = v_hash;
    v_mode := 'static';
  END IF;
  IF v_st.id IS NULL THEN RAISE EXCEPTION 'QR Code não reconhecido pelo PontoSmart.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_emp FROM employees WHERE user_id = auth.uid() AND company_id = v_st.company_id AND status = 'active';
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Este QR Code pertence a outra empresa.' USING ERRCODE = '42501'; END IF;
  PERFORM ps_require(ps_has_perm(v_st.company_id, 'self.clock'), 'Sem permissão para marcar ponto.');
  SELECT * INTO v_loc FROM work_locations WHERE id = v_st.location_id;
  IF NOT v_st.active OR NOT v_loc.active THEN RAISE EXCEPTION 'Estação de marcação inactiva.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_company FROM companies WHERE id = v_st.company_id;
  v_settings := v_company.settings; v_tz := v_company.timezone;

  -- 0) Idempotência
  SELECT ev.id, ev.type, ev.status, ev.occurred_at, va.geofence_result, va.device_result INTO v_prior
    FROM attendance_events ev LEFT JOIN attendance_validations va ON va.event_id = ev.id
   WHERE ev.employee_id = v_emp.id AND ev.idempotency_key = p_idempotency LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('eventId', v_prior.id, 'type', v_prior.type, 'status', v_prior.status, 'occurredAt', v_prior.occurred_at,
      'geofence', COALESCE(v_prior.geofence_result::text, 'unavailable'), 'device', COALESCE(v_prior.device_result::text, 'not_required'),
      'message', 'Pedido já processado.', 'duplicate', true);
  END IF;

  -- 2) Geofence (PostGIS): polígono se existir, senão raio.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT CASE WHEN l.geom IS NOT NULL
                THEN CASE WHEN ST_Covers(l.geom, g) THEN 0 ELSE ST_Distance(l.geom, g) END
                ELSE ST_Distance(l.center, g) - l.radius_m END,
           ST_Distance(l.center, g)
      INTO v_outside, v_center
      FROM work_locations l, (SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g) p
     WHERE l.id = v_loc.id;
  END IF;
  IF v_outside IS NULL OR p_accuracy IS NULL THEN
    v_geo := 'unavailable'; v_geo_msg := 'Localização indisponível. A marcação fica em revisão.';
  ELSIF p_accuracy > v_loc.max_accuracy_m THEN
    v_geo := 'inconclusive'; v_geo_msg := format('Precisão GPS insuficiente (±%s m). Tente novamente ao ar livre ou peça revisão.', round(p_accuracy));
  ELSIF v_outside <= 0 THEN
    v_geo := 'inside'; v_geo_msg := 'Dentro do perímetro autorizado.';
  ELSIF v_outside <= p_accuracy THEN
    v_geo := 'inconclusive'; v_geo_msg := 'Muito perto do limite do local para concluir. Tente novamente ou peça revisão.';
  ELSE
    v_geo := 'outside'; v_geo_msg := format('Fora do perímetro autorizado (a cerca de %s m).', round(v_outside));
  END IF;

  -- 3) Dispositivo de confiança
  IF COALESCE(v_settings ->> 'devicePolicy', 'warn') <> 'off' THEN
    v_device := 'unknown';
    IF p_device_key IS NOT NULL THEN
      SELECT id, CASE WHEN revoked_at IS NULL THEN 'trusted' ELSE 'revoked' END::device_result INTO v_device_id, v_device
        FROM trusted_devices WHERE employee_id = v_emp.id AND credential_id = encode(digest(p_device_key, 'sha256'), 'hex') LIMIT 1;
      IF v_device_id IS NULL THEN v_device := 'unknown'; END IF;
    END IF;
  END IF;

  -- 4) Estado
  IF v_geo = 'outside' THEN
    IF p_request_review THEN v_status := 'review'; v_reasons := v_reasons || 'Fora do perímetro — revisão pedida pelo colaborador.';
    ELSE v_status := 'rejected'; END IF;
  ELSIF v_geo <> 'inside' THEN
    v_status := 'review'; v_reasons := v_reasons || v_geo_msg;
  END IF;
  IF v_settings ->> 'devicePolicy' = 'require' AND v_device <> 'trusted' AND v_status = 'accepted' THEN
    v_status := 'review'; v_reasons := v_reasons || 'Dispositivo não reconhecido como de confiança.'::text;
  END IF;
  IF NULLIF(trim(p_note), '') IS NOT NULL THEN v_reasons := v_reasons || ('Nota do colaborador: ' || left(p_note, 300)); END IF;

  -- 5) Gravação com bloqueio por colaborador
  PERFORM pg_advisory_xact_lock(hashtext(v_emp.id::text));
  SELECT id, type, occurred_at, work_date, status INTO v_last FROM attendance_events
   WHERE employee_id = v_emp.id AND status <> 'rejected' AND occurred_at >= v_now - interval '20 hours'
   ORDER BY occurred_at DESC LIMIT 1;
  v_window := COALESCE((v_settings ->> 'duplicateWindowMinutes')::int, 2);
  IF v_last.id IS NOT NULL AND v_status <> 'rejected' AND v_now - v_last.occurred_at < make_interval(mins => v_window) THEN
    RETURN jsonb_build_object('eventId', v_last.id, 'type', v_last.type, 'status', v_last.status, 'occurredAt', v_last.occurred_at,
      'geofence', v_geo, 'device', v_device, 'message', 'Marcação já registada há instantes. Não foi criada nova marcação.', 'duplicate', true);
  END IF;

  v_type := CASE
    WHEN v_last.id IS NULL OR v_last.type = 'out' THEN 'in'
    WHEN v_last.type = 'break_start' THEN 'break_end'
    WHEN p_requested = 'break_start' THEN 'break_start'
    ELSE 'out' END;
  v_work_date := CASE WHEN v_type = 'in' OR v_last.id IS NULL THEN (v_now AT TIME ZONE v_tz)::date ELSE v_last.work_date END;

  INSERT INTO attendance_events (company_id, employee_id, station_id, location_id, type, occurred_at, work_date, status, source,
                                 idempotency_key, device_id, reason)
  VALUES (v_emp.company_id, v_emp.id, v_st.id, v_loc.id, v_type, v_now, v_work_date, v_status,
          CASE WHEN v_mode = 'dynamic' THEN 'qr_dynamic' ELSE 'qr_static' END, p_idempotency, v_device_id,
          CASE WHEN v_status = 'rejected' THEN v_geo_msg ELSE NULLIF(array_to_string(v_reasons, ' '), '') END)
  RETURNING id INTO v_event;

  INSERT INTO attendance_validations (company_id, event_id, qr_mode, token_valid, latitude, longitude, accuracy_m, distance_m,
                                      geofence_result, device_result, details)
  VALUES (v_emp.company_id, v_event, v_mode, true, round(p_lat::numeric, 5), round(p_lng::numeric, 5),
          round(p_accuracy::numeric, 1), round(v_center::numeric, 1), v_geo, v_device,
          jsonb_build_object('maxAccuracyM', v_loc.max_accuracy_m, 'radiusM', v_loc.radius_m, 'devicePolicy', v_settings ->> 'devicePolicy'));

  IF v_device_id IS NOT NULL THEN UPDATE trusted_devices SET last_used_at = v_now WHERE id = v_device_id; END IF;
  IF v_status <> 'rejected' THEN PERFORM ps_recompute_daily(v_emp.id, v_work_date); END IF;

  v_msg := CASE
    WHEN v_status = 'accepted' THEN CASE v_type WHEN 'in' THEN 'Entrada registada.' WHEN 'out' THEN 'Saída registada.'
                                          WHEN 'break_start' THEN 'Início de intervalo registado.' ELSE 'Fim de intervalo registado.' END
    WHEN v_status = 'review' THEN 'Marcação registada e enviada para revisão.'
    ELSE v_geo_msg END;
  RETURN jsonb_build_object('eventId', v_event, 'type', v_type, 'status', v_status, 'occurredAt', v_now,
                            'geofence', v_geo, 'device', v_device, 'message', v_msg, 'duplicate', false,
                            'distanceM', round(v_center::numeric, 1), 'location', v_loc.name);
END $$;

-- Estado actual do colaborador (para o botão "Marcar entrada/saída").
CREATE OR REPLACE FUNCTION ps_my_status(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp uuid := ps_my_employee(p_company); v_last record;
BEGIN
  PERFORM ps_require(v_emp IS NOT NULL, 'Não tem ficha de colaborador nesta empresa.');
  SELECT type, occurred_at, status, work_date INTO v_last FROM attendance_events
   WHERE employee_id = v_emp AND status <> 'rejected' AND occurred_at >= now() - interval '20 hours'
   ORDER BY occurred_at DESC LIMIT 1;
  RETURN jsonb_build_object('employeeId', v_emp, 'lastType', v_last.type, 'lastAt', v_last.occurred_at, 'lastStatus', v_last.status,
                            'workDate', v_last.work_date);
END $$;

CREATE OR REPLACE FUNCTION ps_register_device(p_company uuid, p_device_key text, p_label text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_emp uuid := ps_my_employee(p_company); v_id uuid; v_hash text := encode(digest(p_device_key, 'sha256'), 'hex');
BEGIN
  PERFORM ps_require(v_emp IS NOT NULL);
  IF length(COALESCE(p_device_key, '')) < 16 THEN RAISE EXCEPTION 'Chave de dispositivo inválida.' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM trusted_devices WHERE employee_id = v_emp AND credential_id = v_hash AND revoked_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF (SELECT count(*) FROM trusted_devices WHERE employee_id = v_emp AND revoked_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'Limite de 3 dispositivos. Remova um no perfil.' USING ERRCODE = '54000';
  END IF;
  -- Dispositivo antes removido: volta a ficar activo.
  UPDATE trusted_devices SET revoked_at = NULL, label = left(COALESCE(p_label, label), 60)
   WHERE employee_id = v_emp AND credential_id = v_hash RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO trusted_devices (company_id, employee_id, credential_id, label) VALUES (p_company, v_emp, v_hash, left(COALESCE(p_label, 'Telemóvel'), 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Revogar um dispositivo de confiança (o próprio colaborador ou quem gere a assiduidade).
CREATE OR REPLACE FUNCTION ps_revoke_device(p_device uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d trusted_devices;
BEGIN
  SELECT * INTO v_d FROM trusted_devices WHERE id = p_device;
  PERFORM ps_require(v_d.id IS NOT NULL AND (ps_is_self_employee(v_d.employee_id) OR ps_has_perm(v_d.company_id, 'attendance.manage')));
  UPDATE trusted_devices SET revoked_at = COALESCE(revoked_at, now()) WHERE id = v_d.id;
END $$;

CREATE OR REPLACE FUNCTION ps_review_event(p_event uuid, p_decision text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ev attendance_events;
BEGIN
  SELECT * INTO v_ev FROM attendance_events WHERE id = p_event;
  -- RH/gestão, ou o supervisor da equipa do colaborador.
  PERFORM ps_require(v_ev.id IS NOT NULL AND (ps_can_employee(v_ev.company_id, v_ev.employee_id, 'attendance.manage')
                     OR ps_can_employee(v_ev.company_id, v_ev.employee_id, 'absence.decide.team')));
  IF EXISTS (SELECT 1 FROM employees WHERE id = v_ev.employee_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Não pode rever as suas próprias marcações.' USING ERRCODE = '42501';
  END IF;
  IF v_ev.status <> 'review' THEN RAISE EXCEPTION 'Esta marcação já foi revista.' USING ERRCODE = '22023'; END IF;
  IF p_decision NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'Decisão inválida.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o fundamento da decisão.' USING ERRCODE = '22023'; END IF;
  UPDATE attendance_events SET status = p_decision::attendance_event_status, reviewed_by = auth.uid(), reviewed_at = now(),
         reason = concat_ws(' ', reason, 'Revisão: ' || p_reason)
   WHERE id = v_ev.id;
  PERFORM ps_recompute_daily(v_ev.employee_id, v_ev.work_date);
  PERFORM ps_audit_log(v_ev.company_id, 'attendance.reviewed', 'attendance_event', v_ev.id::text,
                       jsonb_build_object('status', v_ev.status), jsonb_build_object('status', p_decision, 'reason', p_reason));
END $$;

CREATE OR REPLACE FUNCTION ps_classify_day(p_daily uuid, p_status text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row attendance_daily;
BEGIN
  SELECT * INTO v_row FROM attendance_daily WHERE id = p_daily;
  PERFORM ps_require(v_row.id IS NOT NULL AND ps_can_employee(v_row.company_id, v_row.employee_id, 'attendance.manage'));
  IF v_row.locked THEN RAISE EXCEPTION 'Período fechado. Reabra a assiduidade para corrigir.' USING ERRCODE = '22023'; END IF;
  IF p_status NOT IN ('unjustified', 'justified', 'on_time', 'present') THEN RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o motivo da correcção.' USING ERRCODE = '22023'; END IF;
  UPDATE attendance_daily SET status = p_status::daily_status, updated_at = now() WHERE id = v_row.id;
  INSERT INTO attendance_adjustments (company_id, employee_id, work_date, author_id, reason, previous, next)
  VALUES (v_row.company_id, v_row.employee_id, v_row.work_date, auth.uid(), p_reason,
          jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status));
  PERFORM ps_audit_log(v_row.company_id, 'attendance.adjusted', 'attendance_daily', v_row.id::text,
                       jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status, 'reason', p_reason));
END $$;

-- ---------------------------------------------------------------------
-- 11. Justificações
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_submit_absence(p_company uuid, p_start date, p_end date, p_type text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_manager uuid; v_with_sup boolean; v_id uuid;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = ps_my_employee(p_company);
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(p_company, 'self.absence'), 'Sem ficha de colaborador nesta empresa.');
  IF p_end < p_start THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE = '22023'; END IF;
  IF p_type NOT IN ('doenca', 'consulta', 'falecimento', 'casamento', 'parentalidade', 'formacao', 'servico', 'outro') THEN
    RAISE EXCEPTION 'Tipo de justificação inválido.' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Descreva o motivo (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  SELECT d.manager_user_id INTO v_manager FROM departments d WHERE d.id = v_emp.department_id;
  v_with_sup := (SELECT settings ->> 'absenceFlow' FROM companies WHERE id = p_company) = 'supervisor_then_hr'
                AND v_manager IS NOT NULL AND v_manager <> auth.uid();
  INSERT INTO absence_requests (company_id, employee_id, start_date, end_date, type, reason, created_by)
  VALUES (p_company, v_emp.id, p_start, p_end, p_type, left(trim(p_reason), 2000), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO approval_steps (company_id, request_id, step_order, approver_role)
  SELECT p_company, v_id, o, r FROM unnest(CASE WHEN v_with_sup THEN ARRAY['supervisor', 'hr'] ELSE ARRAY['hr'] END) WITH ORDINALITY AS t(r, o);
  PERFORM ps_audit_log(p_company, 'absence.created', 'absence_request', v_id::text, NULL,
                       jsonb_build_object('startDate', p_start, 'endDate', p_end, 'type', p_type));
  IF v_with_sup THEN
    PERFORM ps_notify(p_company, ARRAY[v_manager], 'absence', 'Justificação para analisar', v_emp.full_name || ' submeteu uma justificação.', '/empresa/justificacoes/');
  ELSE
    PERFORM ps_notify_roles(p_company, ARRAY['hr', 'owner'], 'absence', 'Justificação para analisar', v_emp.full_name || ' submeteu uma justificação.', '/empresa/justificacoes/');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_attach_absence_document(p_request uuid, p_path text, p_name text, p_mime text, p_size integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req absence_requests; v_id uuid;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  PERFORM ps_require(v_req.id IS NOT NULL AND ps_is_self_employee(v_req.employee_id));
  IF p_path NOT LIKE v_req.company_id::text || '/' || v_req.id::text || '/%' THEN RAISE EXCEPTION 'Caminho inválido.' USING ERRCODE = '22023'; END IF;
  IF p_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') OR p_size > 5242880 THEN
    RAISE EXCEPTION 'Use PDF ou imagem até 5 MB.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM absence_documents WHERE request_id = v_req.id) >= 3 THEN
    RAISE EXCEPTION 'Máximo de 3 anexos por pedido.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO absence_documents (company_id, request_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
  VALUES (v_req.company_id, v_req.id, p_path, left(p_name, 120), p_mime, p_size, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_cancel_absence(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req absence_requests;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  PERFORM ps_require(v_req.id IS NOT NULL AND ps_is_self_employee(v_req.employee_id));
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Só pode cancelar pedidos pendentes.' USING ERRCODE = '22023'; END IF;
  UPDATE absence_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
  UPDATE approval_steps SET decision = 'skipped', decided_at = now(), reason = 'Cancelado pelo colaborador'
   WHERE request_id = v_req.id AND decision = 'pending';
END $$;

CREATE OR REPLACE FUNCTION ps_decide_absence(p_request uuid, p_decision text, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_req absence_requests; v_emp employees; v_role text; v_step approval_steps; v_last smallint; v_final boolean;
  d date; v_row attendance_daily;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = v_req.employee_id;
  IF ps_has_perm(v_req.company_id, 'absence.decide') THEN v_role := 'hr';
  ELSIF ps_can_employee(v_req.company_id, v_req.employee_id, 'absence.decide.team') THEN v_role := 'supervisor';
  END IF;
  PERFORM ps_require(v_role IS NOT NULL, 'Sem permissão para decidir este pedido.');
  IF v_emp.user_id = auth.uid() THEN RAISE EXCEPTION 'Não pode decidir o seu próprio pedido.' USING ERRCODE = '42501'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Este pedido já foi decidido.' USING ERRCODE = '22023'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decisão inválida.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o fundamento da decisão.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_step FROM approval_steps WHERE request_id = v_req.id AND decision = 'pending' ORDER BY step_order LIMIT 1;
  IF v_step.id IS NULL THEN RAISE EXCEPTION 'Sem passos pendentes.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'supervisor' AND v_step.approver_role <> 'supervisor' THEN
    RAISE EXCEPTION 'Este pedido aguarda decisão do RH.' USING ERRCODE = '42501';
  END IF;
  SELECT max(step_order) INTO v_last FROM approval_steps WHERE request_id = v_req.id;
  v_final := p_decision = 'rejected' OR v_step.step_order = v_last OR v_role = 'hr';

  UPDATE approval_steps SET decision = p_decision::approval_decision, approver_id = auth.uid(), reason = p_reason, decided_at = now()
   WHERE id = v_step.id;
  IF v_role = 'hr' THEN
    UPDATE approval_steps SET decision = 'skipped', decided_at = now(), reason = 'Decidido pelo RH'
     WHERE request_id = v_req.id AND decision = 'pending' AND id <> v_step.id;
  END IF;

  IF v_final THEN
    UPDATE absence_requests SET status = p_decision::absence_status, decided_at = now(), decision_reason = p_reason WHERE id = v_req.id;
    IF p_decision = 'approved' THEN
      FOR d IN SELECT generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date LOOP
        SELECT * INTO v_row FROM attendance_daily WHERE employee_id = v_req.employee_id AND work_date = d;
        CONTINUE WHEN v_row.id IS NULL OR v_row.locked OR v_row.status NOT IN ('absent_pending', 'unjustified', 'incomplete', 'late');
        UPDATE attendance_daily SET status = 'justified', absence_request_id = v_req.id, updated_at = now() WHERE id = v_row.id;
        INSERT INTO attendance_adjustments (company_id, employee_id, work_date, author_id, reason, previous, next)
        VALUES (v_req.company_id, v_req.employee_id, d, auth.uid(), 'Justificação aprovada: ' || p_reason,
                jsonb_build_object('status', v_row.status), jsonb_build_object('status', 'justified', 'absenceRequestId', v_req.id));
      END LOOP;
    END IF;
    PERFORM ps_notify(v_req.company_id, ARRAY[v_emp.user_id], 'absence',
      CASE WHEN p_decision = 'approved' THEN 'Justificação aprovada' ELSE 'Justificação recusada' END, p_reason, '/app/justificacoes/');
  ELSE
    PERFORM ps_notify_roles(v_req.company_id, ARRAY['hr'], 'absence', 'Justificação validada pelo supervisor',
      v_emp.full_name || ' — aguarda decisão do RH.', '/empresa/justificacoes/');
  END IF;
  PERFORM ps_audit_log(v_req.company_id, 'absence.' || CASE WHEN v_final THEN p_decision ELSE 'step_approved' END,
                       'absence_request', v_req.id::text, NULL, jsonb_build_object('step', v_step.step_order, 'role', v_role, 'reason', p_reason));
  RETURN CASE WHEN v_final THEN p_decision ELSE 'step_approved' END;
END $$;

-- ---------------------------------------------------------------------
-- 12. Salários
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_payroll_period(p_company uuid, p_year integer, p_month integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'payroll.view'));
  INSERT INTO payroll_periods (company_id, year, month) VALUES (p_company, p_year, p_month)
  ON CONFLICT (company_id, year, month) DO NOTHING;
  SELECT id INTO v_id FROM payroll_periods WHERE company_id = p_company AND year = p_year AND month = p_month;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_payroll_close_attendance(p_period uuid, p_reopen boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p payroll_periods; v_from date; v_to date; v_pend int;
BEGIN
  SELECT * INTO v_p FROM payroll_periods WHERE id = p_period;
  PERFORM ps_require(v_p.id IS NOT NULL AND ps_has_perm(v_p.company_id, 'payroll.prepare'));
  v_from := make_date(v_p.year, v_p.month, 1); v_to := (v_from + interval '1 month - 1 day')::date;
  IF p_reopen THEN
    IF v_p.status <> 'attendance_closed' THEN RAISE EXCEPTION 'Só é possível reabrir períodos com assiduidade fechada e sem aprovação.' USING ERRCODE = '22023'; END IF;
    UPDATE attendance_daily SET locked = false WHERE company_id = v_p.company_id AND work_date BETWEEN v_from AND v_to;
    UPDATE payroll_periods SET status = 'open', attendance_closed_at = NULL WHERE id = v_p.id;
    UPDATE payroll_runs SET status = 'superseded' WHERE period_id = v_p.id AND status = 'draft';
    PERFORM ps_audit_log(v_p.company_id, 'payroll.attendance_reopened', 'payroll_period', v_p.id::text);
    RETURN;
  END IF;
  IF v_p.status <> 'open' THEN RAISE EXCEPTION 'A assiduidade deste período já está fechada.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_pend FROM attendance_daily WHERE company_id = v_p.company_id AND work_date BETWEEN v_from AND v_to
     AND status IN ('absent_pending', 'review', 'incomplete');
  IF v_pend > 0 THEN RAISE EXCEPTION 'Existem % pendências de assiduidade por resolver antes do fecho.', v_pend USING ERRCODE = '22023'; END IF;
  UPDATE attendance_daily SET locked = true WHERE company_id = v_p.company_id AND work_date BETWEEN v_from AND v_to;
  UPDATE payroll_periods SET status = 'attendance_closed', attendance_closed_at = now() WHERE id = v_p.id;
  PERFORM ps_audit_log(v_p.company_id, 'payroll.attendance_closed', 'payroll_period', v_p.id::text);
END $$;

-- Dados de entrada do motor salarial (o cálculo é feito pelo motor no site e gravado abaixo).
CREATE OR REPLACE FUNCTION ps_payroll_inputs(p_company uuid, p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from date := make_date(p_year, p_month, 1); v_to date; v_c companies; v_ot payroll_components;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'payroll.view'));
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT * INTO v_c FROM companies WHERE id = p_company;
  SELECT * INTO v_ot FROM payroll_components WHERE company_id = p_company AND calc_type = 'per_hour' AND active
     AND effective_from <= v_to AND (effective_to IS NULL OR effective_to >= v_from) ORDER BY effective_from DESC LIMIT 1;
  RETURN jsonb_build_object(
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'currency', v_c.currency,
    'dailyDivisor', COALESCE((v_c.settings ->> 'payrollDailyDivisor')::int, 30),
    'overtimeComponent', CASE WHEN v_ot.id IS NULL THEN NULL ELSE jsonb_build_object('code', v_ot.code, 'name', v_ot.name,
        'nature', v_ot.nature, 'calcType', v_ot.calc_type, 'value', COALESCE(v_ot.rate, 1)::text, 'taxable', v_ot.taxable) END,
    'rules', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'ruleCode', r.rule_code, 'name', r.name, 'version', r.version,
                 'validated', r.validated, 'params', r.params) ORDER BY r.rule_code), '[]')
              FROM (SELECT DISTINCT ON (rule_code) * FROM payroll_rule_versions
                     WHERE (company_id IS NULL OR company_id = p_company) AND effective_from <= v_to
                       AND (effective_to IS NULL OR effective_to >= v_from)
                     ORDER BY rule_code, (company_id IS NOT NULL) DESC, version DESC) r),
    'employees', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'employeeId', e.id, 'code', e.employee_code, 'name', e.full_name,
        'baseSalary', (SELECT to_char(a.amount, 'FM999999999990.00') FROM salary_agreements a WHERE a.employee_id = e.id
                         AND a.effective_from <= v_to AND (a.effective_to IS NULL OR a.effective_to >= v_from)
                       ORDER BY a.effective_from DESC LIMIT 1),
        'weeklyHours', COALESCE((SELECT k.weekly_hours FROM employment_contracts k WHERE k.employee_id = e.id AND k.start_date <= v_to
                                  ORDER BY k.start_date DESC LIMIT 1), 40),
        'attendance', (SELECT jsonb_build_object(
              'unjustifiedDays', count(*) FILTER (WHERE d.status = 'unjustified'),
              'overtimeMinutes', COALESCE(sum(d.overtime_minutes), 0),
              'workedDays', count(*) FILTER (WHERE d.worked_minutes > 0))
            FROM attendance_daily d WHERE d.employee_id = e.id AND d.work_date BETWEEN v_from AND v_to),
        'components', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', pc.code, 'name', pc.name, 'nature', pc.nature,
              'calcType', pc.calc_type, 'value', to_char(ec.amount, 'FM999999999990.00'), 'taxable', pc.taxable) ORDER BY pc.code), '[]')
            FROM employee_components ec JOIN payroll_components pc ON pc.id = ec.component_id
           WHERE ec.employee_id = e.id AND pc.active AND pc.calc_type <> 'per_hour'
             AND ec.effective_from <= v_to AND (ec.effective_to IS NULL OR ec.effective_to >= v_from))
      ) ORDER BY e.employee_code), '[]')
      FROM employees e WHERE e.company_id = p_company AND e.status = 'active' AND (e.hire_date IS NULL OR e.hire_date <= v_to))
  );
END $$;

CREATE OR REPLACE FUNCTION ps_payroll_save_run(p_period uuid, p_engine_version text, p_input_hash text, p_totals jsonb, p_warnings jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p payroll_periods; v_run uuid; v_version int; it jsonb; ln jsonb; v_item uuid; v_cur text;
BEGIN
  SELECT * INTO v_p FROM payroll_periods WHERE id = p_period;
  PERFORM ps_require(v_p.id IS NOT NULL AND ps_has_perm(v_p.company_id, 'payroll.prepare'));
  IF v_p.status <> 'attendance_closed' THEN RAISE EXCEPTION 'Feche a assiduidade do período antes do pré-processamento.' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_cur FROM companies WHERE id = v_p.company_id;
  PERFORM pg_advisory_xact_lock(hashtext(v_p.id::text));
  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM payroll_runs WHERE period_id = v_p.id;
  UPDATE payroll_runs SET status = 'superseded' WHERE period_id = v_p.id AND status = 'draft';
  INSERT INTO payroll_runs (company_id, period_id, version, status, engine_version, input_hash, prepared_by, totals, warnings)
  VALUES (v_p.company_id, v_p.id, v_version, 'draft', p_engine_version, p_input_hash, auth.uid(), p_totals, COALESCE(p_warnings, '[]'))
  RETURNING id INTO v_run;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    PERFORM 1 FROM employees WHERE id = (it ->> 'employeeId')::uuid AND company_id = v_p.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador inválido no processamento.' USING ERRCODE = '22023'; END IF;
    INSERT INTO payroll_items (company_id, run_id, employee_id, gross, deductions, net, currency, snapshot)
    VALUES (v_p.company_id, v_run, (it ->> 'employeeId')::uuid, (it ->> 'gross')::numeric, (it ->> 'deductions')::numeric,
            (it ->> 'net')::numeric, v_cur, COALESCE(it -> 'snapshot', '{}'))
    RETURNING id INTO v_item;
    FOR ln IN SELECT * FROM jsonb_array_elements(COALESCE(it -> 'lines', '[]')) LOOP
      INSERT INTO payroll_lines (company_id, payroll_item_id, code, description, nature, quantity, rate, amount, origin, rule_version_id, sort)
      VALUES (v_p.company_id, v_item, ln ->> 'code', ln ->> 'description', (ln ->> 'nature')::component_nature,
              NULLIF(ln ->> 'quantity', '')::numeric, NULLIF(ln ->> 'rate', '')::numeric, (ln ->> 'amount')::numeric,
              ln ->> 'origin', NULLIF(ln ->> 'ruleVersionId', '')::uuid, COALESCE((ln ->> 'sort')::int, 0));
    END LOOP;
  END LOOP;
  PERFORM ps_audit_log(v_p.company_id, 'payroll.run_prepared', 'payroll_run', v_run::text, NULL,
                       jsonb_build_object('version', v_version, 'totals', p_totals, 'inputHash', p_input_hash));
  RETURN v_run;
END $$;

CREATE OR REPLACE FUNCTION ps_payroll_approve(p_run uuid, p_input_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_run payroll_runs;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run;
  PERFORM ps_require(v_run.id IS NOT NULL AND ps_has_perm(v_run.company_id, 'payroll.approve'));
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'Apenas execuções em rascunho podem ser aprovadas.' USING ERRCODE = '22023'; END IF;
  IF v_run.prepared_by = auth.uid() THEN
    RAISE EXCEPTION 'Separação de funções: a aprovação tem de ser feita por outra pessoa.' USING ERRCODE = '42501';
  END IF;
  IF p_input_hash IS DISTINCT FROM v_run.input_hash THEN
    RAISE EXCEPTION 'Os dados mudaram desde o pré-processamento. Gere uma nova versão.' USING ERRCODE = '22023';
  END IF;
  UPDATE payroll_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = v_run.id;
  UPDATE payroll_periods SET status = 'approved' WHERE id = v_run.period_id;
  PERFORM ps_audit_log(v_run.company_id, 'payroll.run_approved', 'payroll_run', v_run.id::text, NULL, jsonb_build_object('version', v_run.version));
END $$;

CREATE OR REPLACE FUNCTION ps_payroll_close_period(p_period uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p payroll_periods;
BEGIN
  SELECT * INTO v_p FROM payroll_periods WHERE id = p_period;
  PERFORM ps_require(v_p.id IS NOT NULL AND ps_has_perm(v_p.company_id, 'payroll.approve'));
  IF v_p.status <> 'approved' THEN RAISE EXCEPTION 'Só é possível encerrar períodos com salários aprovados.' USING ERRCODE = '22023'; END IF;
  UPDATE payroll_periods SET status = 'closed', closed_at = now() WHERE id = v_p.id;
  PERFORM ps_audit_log(v_p.company_id, 'payroll.period_closed', 'payroll_period', v_p.id::text);
END $$;

-- Registo de exportações (relatórios descarregados no navegador).
CREATE OR REPLACE FUNCTION ps_log_export(p_company uuid, p_report text, p_details jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'reports.export'));
  PERFORM ps_audit_log(p_company, 'report.exported', 'report', left(p_report, 60), NULL, p_details);
END $$;

CREATE OR REPLACE FUNCTION ps_issue_payslips(p_run uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_run payroll_runs; v_p payroll_periods; r record; v_n int := 0; v_i int := 0;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run;
  PERFORM ps_require(v_run.id IS NOT NULL AND ps_has_perm(v_run.company_id, 'payslips.issue'));
  IF v_run.status <> 'approved' THEN RAISE EXCEPTION 'Só é possível emitir recibos de execuções aprovadas.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_p FROM payroll_periods WHERE id = v_run.period_id;
  FOR r IN SELECT i.id, i.employee_id, e.user_id FROM payroll_items i JOIN employees e ON e.id = i.employee_id
            WHERE i.run_id = v_run.id ORDER BY e.employee_code LOOP
    v_i := v_i + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM payslips WHERE payroll_item_id = r.id);
    INSERT INTO payslips (company_id, payroll_item_id, employee_id, run_id, reference, issued_by)
    VALUES (v_run.company_id, r.id, r.employee_id, v_run.id,
            format('RV-%s%s-%s-%s', v_p.year, lpad(v_p.month::text, 2, '0'), upper(left(v_run.id::text, 6)), lpad(v_i::text, 3, '0')), auth.uid());
    PERFORM ps_notify(v_run.company_id, ARRAY[r.user_id], 'payslip', 'Novo recibo disponível',
                      format('O recibo de %s/%s já está disponível.', lpad(v_p.month::text, 2, '0'), v_p.year), '/app/recibos/');
    v_n := v_n + 1;
  END LOOP;
  PERFORM ps_audit_log(v_run.company_id, 'payroll.payslips_issued', 'payroll_run', v_run.id::text, NULL, jsonb_build_object('issued', v_n));
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION ps_register_payment(p_item uuid, p_amount numeric, p_paid_at date, p_method text, p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item payroll_items; v_status payroll_run_status; v_id uuid;
BEGIN
  SELECT * INTO v_item FROM payroll_items WHERE id = p_item;
  PERFORM ps_require(v_item.id IS NOT NULL AND ps_has_perm(v_item.company_id, 'payments.register'));
  SELECT status INTO v_status FROM payroll_runs WHERE id = v_item.run_id;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'Só é possível registar pagamentos de execuções aprovadas.' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023'; END IF;
  INSERT INTO salary_payments (company_id, payroll_item_id, amount, paid_at, method, reference, registered_by)
  VALUES (v_item.company_id, v_item.id, round(p_amount, 2), p_paid_at, left(p_method, 40), NULLIF(left(p_reference, 80), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM ps_audit_log(v_item.company_id, 'payroll.payment_registered', 'salary_payment', v_id::text, NULL,
                       jsonb_build_object('item', p_item, 'amount', p_amount, 'method', p_method));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_ack_payslip(p_payslip uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s payslips;
BEGIN
  SELECT * INTO v_s FROM payslips WHERE id = p_payslip;
  PERFORM ps_require(v_s.id IS NOT NULL AND ps_is_self_employee(v_s.employee_id));
  INSERT INTO payslip_acknowledgements (company_id, payslip_id, employee_id) VALUES (v_s.company_id, v_s.id, v_s.employee_id)
  ON CONFLICT (payslip_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 13. Painel da empresa: indicadores e contexto do assistente
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ps_company_dashboard(p_company uuid, p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date; v_team boolean;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'attendance.view'));
  v_today := (now() AT TIME ZONE ps_company_tz(p_company))::date;
  v_team := ps_role(p_company) = 'supervisor';
  RETURN (
    WITH staff AS (
      SELECT e.* FROM employees e WHERE e.company_id = p_company AND e.status = 'active'
        AND (NOT v_team OR EXISTS (SELECT 1 FROM departments d WHERE d.id = e.department_id AND d.manager_user_id = auth.uid())))
    SELECT jsonb_build_object(
      'today', v_today,
      'activeEmployees', (SELECT count(*) FROM staff),
      'todayRows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'employeeId', s.id, 'name', s.full_name, 'code', s.employee_code, 'jobTitle', s.job_title,
            'department', (SELECT name FROM departments WHERE id = s.department_id),
            'status', d.status, 'firstIn', d.first_in, 'lastOut', d.last_out, 'lateMinutes', d.late_minutes,
            'workedMinutes', d.worked_minutes,
            'lastEvent', (SELECT jsonb_build_object('type', ev.type, 'at', ev.occurred_at, 'status', ev.status)
                            FROM attendance_events ev WHERE ev.employee_id = s.id AND ev.work_date = v_today
                            ORDER BY ev.occurred_at DESC LIMIT 1)) ORDER BY s.full_name), '[]')
          FROM staff s LEFT JOIN attendance_daily d ON d.employee_id = s.id AND d.work_date = v_today),
      'series', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', g::date,
            'present', (SELECT count(*) FROM attendance_daily d JOIN staff s ON s.id = d.employee_id
                         WHERE d.work_date = g::date AND d.status IN ('on_time', 'late', 'present', 'incomplete', 'review')),
            'late', (SELECT count(*) FROM attendance_daily d JOIN staff s ON s.id = d.employee_id WHERE d.work_date = g::date AND d.status = 'late'),
            'absent', (SELECT count(*) FROM attendance_daily d JOIN staff s ON s.id = d.employee_id
                        WHERE d.work_date = g::date AND d.status IN ('absent_pending', 'unjustified', 'justified')),
            'expected', (SELECT count(*) FROM attendance_daily d JOIN staff s ON s.id = d.employee_id
                          WHERE d.work_date = g::date AND d.status NOT IN ('holiday', 'day_off'))) ORDER BY g), '[]')
          FROM generate_series(v_today - (LEAST(GREATEST(p_days, 7), 120) - 1), v_today, interval '1 day') g),
      'byDepartment', (SELECT COALESCE(jsonb_agg(x ORDER BY x.name), '[]') FROM (
            SELECT COALESCE(dep.name, 'Sem departamento') AS name,
                   count(*) FILTER (WHERE d.status IN ('on_time', 'present')) AS on_time,
                   count(*) FILTER (WHERE d.status = 'late') AS late,
                   count(*) FILTER (WHERE d.status IN ('absent_pending', 'unjustified', 'justified')) AS absent
              FROM staff s LEFT JOIN departments dep ON dep.id = s.department_id
              JOIN attendance_daily d ON d.employee_id = s.id AND d.work_date > v_today - 30
             GROUP BY 1) x),
      'pendingReviews', (SELECT count(*) FROM attendance_events ev JOIN staff s ON s.id = ev.employee_id WHERE ev.status = 'review'),
      'pendingAbsences', (SELECT count(*) FROM absence_requests a JOIN staff s ON s.id = a.employee_id WHERE a.status = 'pending'),
      'monthLateMinutes', (SELECT COALESCE(sum(d.late_minutes), 0) FROM attendance_daily d JOIN staff s ON s.id = d.employee_id
                            WHERE d.work_date >= date_trunc('month', v_today)::date)
    ));
END $$;

CREATE OR REPLACE FUNCTION ps_ai_context(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date; v jsonb;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'ai.use'), 'Sem acesso ao assistente.');
  v_today := (now() AT TIME ZONE ps_company_tz(p_company))::date;
  SELECT jsonb_build_object(
    'empresa', (SELECT name FROM companies WHERE id = p_company),
    'hoje', v_today,
    'papel', ps_role(p_company),
    'resumo', ps_company_dashboard(p_company, 30) - 'todayRows' - 'series',
    'hojeDetalhe', (SELECT jsonb_agg(jsonb_build_object('nome', x ->> 'name', 'estado', x ->> 'status', 'atrasoMin', x ->> 'lateMinutes'))
                    FROM jsonb_array_elements(ps_company_dashboard(p_company, 7) -> 'todayRows') x),
    'atrasos30dias', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', e.full_name, 'dias', t.n, 'minutos', t.m) ORDER BY t.m DESC), '[]')
                      FROM (SELECT employee_id, count(*) n, sum(late_minutes) m FROM attendance_daily
                             WHERE company_id = p_company AND status = 'late' AND work_date > v_today - 30 GROUP BY employee_id) t
                      JOIN employees e ON e.id = t.employee_id),
    'justificacoesPendentes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', e.full_name, 'de', a.start_date, 'ate', a.end_date, 'tipo', a.type)), '[]')
                               FROM absence_requests a JOIN employees e ON e.id = a.employee_id
                               WHERE a.company_id = p_company AND a.status = 'pending'),
    'salarios', CASE WHEN ps_has_perm(p_company, 'payroll.view') THEN
        (SELECT jsonb_agg(jsonb_build_object('periodo', p.year || '-' || lpad(p.month::text, 2, '0'), 'estado', p.status,
                 'execucao', (SELECT jsonb_build_object('versao', r.version, 'estado', r.status, 'totais', r.totals, 'avisos', r.warnings)
                                FROM payroll_runs r WHERE r.period_id = p.id ORDER BY r.version DESC LIMIT 1)) ORDER BY p.year DESC, p.month DESC)
           FROM (SELECT * FROM payroll_periods WHERE company_id = p_company ORDER BY year DESC, month DESC LIMIT 3) p)
      ELSE NULL END
  ) INTO v;
  RETURN v;
END $$;

-- ---------------------------------------------------------------------
-- 14. Permissões de execução das funções
-- ---------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ps\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig); END IF;
    -- Internas: só a base de dados as usa.
    CONTINUE WHEN f.proname IN ('ps_auth_upsert', 'ps_auth_disable', 'ps_audit_log', 'ps_notify', 'ps_notify_roles',
                                'ps_audit_trigger', 'ps_location_geo', 'ps_employee_status', 'ps_recompute_daily', 'ps_close_day');
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION ps_submit_company_request(text, text, text, text, text, text, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION ps_login_email(text) TO anon;
-- Funções usadas dentro das regras de acesso (devolvem falso para visitantes).
GRANT EXECUTE ON FUNCTION ps_uid(), ps_is_platform_admin(), ps_is_member(uuid), ps_has_perm(uuid, text), ps_role(uuid),
  ps_my_employee(uuid), ps_can_employee(uuid, uuid, text), ps_is_self_employee(uuid) TO anon;

-- ---------------------------------------------------------------------
-- 15. Anexos privados (Storage)
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('justificacoes', 'justificacoes', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS ps_just_insert ON storage.objects;
DROP POLICY IF EXISTS ps_just_read ON storage.objects;
DROP POLICY IF EXISTS ps_just_delete ON storage.objects;
-- Caminho: <empresa>/<pedido>/<ficheiro>. O colaborador só envia para os próprios pedidos.
CREATE POLICY ps_just_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]
       AND r.status = 'pending' AND public.ps_is_self_employee(r.employee_id)));
-- O colaborador pode apagar anexos dos próprios pedidos pendentes (ex.: envio falhado).
CREATE POLICY ps_just_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]
       AND r.status = 'pending' AND public.ps_is_self_employee(r.employee_id)));
CREATE POLICY ps_just_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- 16. Fecho diário automático (se a extensão pg_cron estiver activa)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pontosmart-fecho-diario';
    PERFORM cron.schedule('pontosmart-fecho-diario', '30 22 * * *', 'SELECT public.ps_close_day()');
  END IF;
END $$;

COMMIT;
