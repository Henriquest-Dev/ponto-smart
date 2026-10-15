-- PontoSmart, script 4, parte 3 de 5: empresas, colaboradores e assiduidade
BEGIN;
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
CREATE OR REPLACE FUNCTION ps_set_access(p_employee uuid, p_login text, p_password text, p_role text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_user uuid; v_role uuid; v_role_code text := NULLIF(p_role, ''); v_login text := lower(trim(p_login));
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
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
COMMIT;
