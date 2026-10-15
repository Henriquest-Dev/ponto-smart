-- Horbit, script 4, parte 2 de 5: permissões (RLS) e pedidos de conta
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'ps\_%' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;
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
GRANT SELECT ON absence_requests, absence_documents, approval_steps TO authenticated;
CREATE POLICY ps_read ON absence_requests FOR SELECT TO authenticated
  USING (ps_is_self_employee(employee_id) OR ps_can_employee(company_id, employee_id, 'absence.decide')
         OR ps_can_employee(company_id, employee_id, 'absence.decide.team'));
CREATE POLICY ps_read ON absence_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM absence_requests r WHERE r.id = request_id));
CREATE POLICY ps_read ON approval_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM absence_requests r WHERE r.id = request_id));
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
CREATE OR REPLACE FUNCTION ps_submit_company_request(
  p_company_name text, p_contact_name text, p_email text, p_phone text DEFAULT NULL, p_nuit text DEFAULT NULL,
  p_city text DEFAULT NULL, p_employees integer DEFAULT NULL, p_plan_code text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_key text; v_count int;
BEGIN
  -- Pedido simples: nome da empresa, email e o motivo. Os restantes dados são pedidos depois, por email.
  IF length(trim(COALESCE(p_company_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Indique o nome da empresa.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Indique um email válido.' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(p_message, ''))) < 10 THEN
    RAISE EXCEPTION 'Explique em poucas palavras porque pede o acesso.' USING ERRCODE = '22023';
  END IF;
  v_key := 'req:' || lower(trim(p_email)) || ':' || current_date;
  INSERT INTO rate_limits (key, window_start, count) VALUES (v_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_count;
  IF v_count > 3 THEN RAISE EXCEPTION 'Já recebemos o seu pedido. Aguarde o nosso contacto.' USING ERRCODE = '54000'; END IF;
  INSERT INTO rate_limits (key, window_start, count) VALUES ('req:all:' || current_date, now(), 1)
  ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count INTO v_count;
  IF v_count > 300 THEN RAISE EXCEPTION 'Muitos pedidos hoje. Tente amanhã.' USING ERRCODE = '54000'; END IF;
  INSERT INTO company_requests (company_name, nuit, contact_name, email, phone, city, employees_estimate, plan_id, message)
  VALUES (left(trim(p_company_name), 160), NULLIF(left(trim(p_nuit), 20), ''), NULLIF(left(trim(p_contact_name), 120), ''),
          lower(trim(p_email)), NULLIF(left(trim(p_phone), 30), ''), NULLIF(left(trim(p_city), 80), ''),
          CASE WHEN p_employees BETWEEN 1 AND 100000 THEN p_employees END,
          (SELECT id FROM subscription_plans WHERE code = p_plan_code AND active),
          left(trim(p_message), 1000))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
COMMIT;
