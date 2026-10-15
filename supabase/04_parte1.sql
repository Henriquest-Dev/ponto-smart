-- PontoSmart, script 4, parte 1 de 5: contas e regras base
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS ps_secrets (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE ps_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ps_secrets FROM PUBLIC;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_company_uq ON memberships (user_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_daily_emp_date_uq ON attendance_daily (employee_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_periods_company_month_uq ON payroll_periods (company_id, year, month);
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
CREATE OR REPLACE FUNCTION ps_auth_disable(p_id uuid, p_disabled boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE auth.users SET banned_until = CASE WHEN p_disabled THEN 'infinity'::timestamptz END, updated_at = now() WHERE id = p_id;
$$;
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
CREATE OR REPLACE FUNCTION ps_location_geo() RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions, pg_temp AS $$
BEGIN
  NEW.center := ST_SetSRID(ST_MakePoint(NEW.center_lng::float8, NEW.center_lat::float8), 4326)::geography;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ps_location_geo ON work_locations;
CREATE TRIGGER ps_location_geo BEFORE INSERT OR UPDATE OF center_lat, center_lng ON work_locations
  FOR EACH ROW EXECUTE FUNCTION ps_location_geo();
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
COMMIT;
