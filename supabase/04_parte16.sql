-- Horbit, script 4, parte 16: resumo mensal do Orbi por email.
-- No início de cada mês, o Orbi envia ao responsável (email da empresa e emails dos responsáveis) o resumo do mês anterior:
-- equipa, horas, atrasos, faltas, pendentes, salários, estoque e oficina, com um texto escrito pelo assistente.
-- Requer as partes 14 e 15. Pode ser executado de novo sem problema.
BEGIN;

CREATE TABLE IF NOT EXISTS monthly_reports (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  month text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent',
  PRIMARY KEY (company_id, month)
);
ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON monthly_reports FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON monthly_reports FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON monthly_reports FROM authenticated'; END IF;
END $$;

-- Para quem vai o resumo: email da empresa e emails dos responsáveis (proprietários).
CREATE OR REPLACE FUNCTION ps_owner_emails(p_company uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM (
    SELECT lower(email) AS x FROM companies WHERE id = p_company AND email LIKE '%@%'
    UNION SELECT lower(u.email) FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
           WHERE m.company_id = p_company AND m.active AND r.code = 'owner' AND u.email NOT LIKE '%@pontosmart.app'
    UNION SELECT lower(e.email) FROM memberships m JOIN roles r ON r.id = m.role_id JOIN employees e ON e.user_id = m.user_id AND e.company_id = m.company_id
           WHERE m.company_id = p_company AND m.active AND r.code = 'owner' AND e.email LIKE '%@%') t
  WHERE x ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

-- Qualquer pessoa da empresa (ao abrir o Horbit) pergunta se falta enviar o resumo do mês passado.
-- Devolve o mês (AAAA-MM) se estiver por enviar; NULL se já foi, se está desligado ou se não há a quem enviar.
CREATE OR REPLACE FUNCTION ps_monthly_report_due(p_company uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_month text := to_char((now() AT TIME ZONE ps_company_tz(p_company))::date - interval '1 month', 'YYYY-MM');
BEGIN
  IF NOT ps_is_member(p_company) THEN RETURN NULL; END IF;
  IF COALESCE((SELECT (settings ->> 'monthlyReport')::boolean FROM companies WHERE id = p_company), true) = false THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM monthly_reports WHERE company_id = p_company AND month = v_month) THEN RETURN NULL; END IF;
  -- Empresas criadas neste mês ainda não têm mês anterior para resumir.
  IF (SELECT created_at FROM companies WHERE id = p_company) >= date_trunc('month', now()) THEN RETURN NULL; END IF;
  IF cardinality(ps_owner_emails(p_company)) = 0 THEN RETURN NULL; END IF;
  RETURN v_month;
END $$;

-- Estado e opção (painel da empresa).
CREATE OR REPLACE FUNCTION ps_monthly_report_status(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'employees.manage') OR ps_has_perm(p_company, 'company.settings.manage'));
  RETURN jsonb_build_object(
    'enabled', COALESCE((SELECT (settings ->> 'monthlyReport')::boolean FROM companies WHERE id = p_company), true),
    'recipients', to_jsonb(ps_owner_emails(p_company)),
    'last', (SELECT jsonb_build_object('month', month, 'sentAt', sent_at, 'recipients', to_jsonb(recipients), 'status', status)
               FROM monthly_reports WHERE company_id = p_company ORDER BY month DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION ps_monthly_report_set(p_company uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'company.settings.manage'), 'Só o responsável ou o administrador mudam esta opção.');
  UPDATE companies SET settings = settings || jsonb_build_object('monthlyReport', p_enabled), updated_at = now() WHERE id = p_company;
END $$;

-- Só a Edge Function (chave de serviço): marca o mês como enviado (uma vez) e junta os números do mês.
CREATE OR REPLACE FUNCTION ps_monthly_report_claim(p_company uuid, p_month text, p_recipients text[], p_force boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_force THEN
    INSERT INTO monthly_reports (company_id, month, recipients) VALUES (p_company, p_month, p_recipients)
    ON CONFLICT (company_id, month) DO UPDATE SET sent_at = now(), recipients = EXCLUDED.recipients, status = 'sent';
    RETURN true;
  END IF;
  INSERT INTO monthly_reports (company_id, month, recipients) VALUES (p_company, p_month, p_recipients)
  ON CONFLICT (company_id, month) DO NOTHING RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END $$;

CREATE OR REPLACE FUNCTION ps_monthly_report_failed(p_company uuid, p_month text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM monthly_reports WHERE company_id = p_company AND month = p_month AND sent_at > now() - interval '10 minutes';
$$;

CREATE OR REPLACE FUNCTION ps_month_summary(p_company uuid, p_month text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from date := (p_month || '-01')::date; v_to date := ((p_month || '-01')::date + interval '1 month')::date; v jsonb;
  v_stock jsonb := '[]'::jsonb; v_shop jsonb := NULL;
BEGIN
  IF to_regclass('public.stock_items') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'unit', unit, 'min', min_quantity) ORDER BY quantity), '[]')
               FROM (SELECT * FROM stock_items WHERE company_id = $1 AND active AND quantity <= min_quantity ORDER BY quantity LIMIT 8) s$q$
      INTO v_stock USING p_company;
  END IF;
  IF to_regclass('public.vehicle_visits') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_build_object('visits', count(*), 'vehicles', count(DISTINCT vehicle_id), 'amount', COALESCE(sum(amount), 0))
               FROM vehicle_visits WHERE company_id = $1 AND entered_at >= $2 AND entered_at < $3$q$
      INTO v_shop USING p_company, v_from::timestamp AT TIME ZONE ps_company_tz(p_company), v_to::timestamp AT TIME ZONE ps_company_tz(p_company);
  END IF;
  SELECT jsonb_build_object(
    'month', p_month,
    'company', (SELECT jsonb_build_object('name', name, 'email', email, 'phone', phone, 'address', address, 'nuit', nuit, 'currency', currency) FROM companies WHERE id = p_company),
    'recipients', to_jsonb(ps_owner_emails(p_company)),
    'team', jsonb_build_object(
      'active', (SELECT count(*) FROM employees WHERE company_id = p_company AND status = 'active'),
      'hired', (SELECT count(*) FROM employees WHERE company_id = p_company AND hire_date >= v_from AND hire_date < v_to),
      'withAccess', (SELECT count(*) FROM memberships WHERE company_id = p_company AND active)),
    'attendance', (SELECT jsonb_build_object(
        'workedHours', round(COALESCE(sum(worked_minutes), 0) / 60.0),
        'overtimeHours', round(COALESCE(sum(overtime_minutes), 0) / 60.0, 1),
        'lateDays', count(*) FILTER (WHERE late_minutes > 0),
        'lateMinutes', COALESCE(sum(late_minutes), 0),
        'unjustified', count(*) FILTER (WHERE status = 'unjustified'),
        'absentPending', count(*) FILTER (WHERE status = 'absent_pending'),
        'justified', count(*) FILTER (WHERE status = 'justified'),
        'daysWorked', count(*) FILTER (WHERE worked_minutes > 0))
      FROM attendance_daily WHERE company_id = p_company AND work_date >= v_from AND work_date < v_to),
    'topLate', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'days', days, 'minutes', minutes) ORDER BY days DESC, minutes DESC), '[]')
                  FROM (SELECT e.full_name AS name, count(*) AS days, sum(d.late_minutes) AS minutes
                          FROM attendance_daily d JOIN employees e ON e.id = d.employee_id
                         WHERE d.company_id = p_company AND d.work_date >= v_from AND d.work_date < v_to AND d.late_minutes > 0
                         GROUP BY e.full_name ORDER BY count(*) DESC, sum(d.late_minutes) DESC LIMIT 5) t),
    'pending', jsonb_build_object(
      'justifications', (SELECT count(*) FROM absence_requests WHERE company_id = p_company AND status = 'pending'),
      'reviews', (SELECT count(*) FROM attendance_events WHERE company_id = p_company AND status = 'review')),
    'payroll', (SELECT jsonb_build_object('status', p.status, 'totals', (SELECT r.totals FROM payroll_runs r WHERE r.period_id = p.id AND r.status <> 'superseded' ORDER BY r.version DESC LIMIT 1))
                  FROM payroll_periods p WHERE p.company_id = p_company AND p.year = extract(year FROM v_from) AND p.month = extract(month FROM v_from)),
    'stockAlerts', v_stock,
    'workshop', v_shop) INTO v;
  RETURN v;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_monthly_report_due(uuid)', 'ps_monthly_report_status(uuid)', 'ps_monthly_report_set(uuid, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['ps_owner_emails(uuid)', 'ps_monthly_report_claim(uuid, text, text[], boolean)', 'ps_monthly_report_failed(uuid, text)', 'ps_month_summary(uuid, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
  END LOOP;
END $$;

COMMIT;
