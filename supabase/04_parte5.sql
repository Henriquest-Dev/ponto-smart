-- Horbit, script 4, parte 5 de 5: salários, painel, anexos e permissões finais
BEGIN;
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
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ps\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig); END IF;
    CONTINUE WHEN f.proname IN ('ps_auth_upsert', 'ps_auth_disable', 'ps_audit_log', 'ps_notify', 'ps_notify_roles',
                                'ps_audit_trigger', 'ps_location_geo', 'ps_employee_status', 'ps_recompute_daily', 'ps_close_day');
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION ps_submit_company_request(text, text, text, text, text, text, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION ps_login_email(text) TO anon;
GRANT EXECUTE ON FUNCTION ps_uid(), ps_is_platform_admin(), ps_is_member(uuid), ps_has_perm(uuid, text), ps_role(uuid),
  ps_my_employee(uuid), ps_can_employee(uuid, uuid, text), ps_is_self_employee(uuid) TO anon;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('justificacoes', 'justificacoes', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS ps_just_insert ON storage.objects;
DROP POLICY IF EXISTS ps_just_read ON storage.objects;
DROP POLICY IF EXISTS ps_just_delete ON storage.objects;
CREATE POLICY ps_just_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]
       AND r.status = 'pending' AND public.ps_is_self_employee(r.employee_id)));
CREATE POLICY ps_just_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]
       AND r.status = 'pending' AND public.ps_is_self_employee(r.employee_id)));
CREATE POLICY ps_just_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'justificacoes' AND EXISTS (
    SELECT 1 FROM public.absence_requests r
     WHERE r.id::text = (storage.foldername(name))[2] AND r.company_id::text = (storage.foldername(name))[1]));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pontosmart-fecho-diario';
    PERFORM cron.schedule('pontosmart-fecho-diario', '30 22 * * *', 'SELECT public.ps_close_day()');
  END IF;
END $$;
COMMIT;
