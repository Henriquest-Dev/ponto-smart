-- Horbit, script 4, parte 9: assistente com acesso a toda a gestão de pessoas (ficha, acessos, salários, horários)
-- e aviso ao responsável da empresa (notificação no Horbit e email). Pode ser executado de novo sem problema.
BEGIN;

-- 1. Contexto adicional do assistente: todas as pessoas (incluindo inactivas e cessadas), acessos, organização
--    e as permissões de quem está a falar. As acções continuam a correr com o login e as permissões dessa pessoa.
CREATE OR REPLACE FUNCTION ps_ai_context_extra(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE ps_company_tz(p_company))::date;
        v_view boolean := ps_has_perm(p_company, 'employees.view');
        v_salary boolean := ps_has_perm(p_company, 'employees.salary.view') OR ps_has_perm(p_company, 'payroll.view');
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'ai.use'), 'Sem acesso ao assistente.');
  RETURN jsonb_build_object(
    'minhasPermissoes', (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]') FROM permissions p WHERE ps_has_perm(p_company, p.code)),
    'pessoas', CASE WHEN v_view THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'nome', e.full_name, 'numero', e.employee_code,
        'estado', CASE e.status WHEN 'active' THEN 'activo' WHEN 'inactive' THEN 'inactivo' ELSE 'cessado' END,
        'funcao', e.job_title, 'departamento', d.name, 'filial', b.name, 'email', e.email, 'telefone', e.phone,
        'nuit', e.nuit, 'admissao', e.hire_date,
        'acesso', CASE WHEN m.active THEN 'sim' WHEN m.id IS NOT NULL THEN 'retirado' ELSE 'não' END,
        'utilizador', CASE WHEN u.id IS NOT NULL THEN replace(u.email, '@pontosmart.app', '') END,
        'papel', r.code,
        'horario', (SELECT ws.name FROM shift_assignments sa JOIN work_schedules ws ON ws.id = sa.schedule_id
                     WHERE sa.employee_id = e.id AND sa.valid_from <= v_today AND (sa.valid_to IS NULL OR sa.valid_to >= v_today)
                     ORDER BY sa.valid_from DESC LIMIT 1),
        'salarioBase', CASE WHEN v_salary THEN (SELECT s.amount FROM salary_agreements s WHERE s.employee_id = e.id AND s.effective_from <= v_today
                         AND (s.effective_to IS NULL OR s.effective_to >= v_today) ORDER BY s.effective_from DESC LIMIT 1) END
      ) ORDER BY e.full_name), '[]')
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN branches b ON b.id = e.branch_id
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN memberships m ON m.user_id = e.user_id AND m.company_id = e.company_id
      LEFT JOIN roles r ON r.id = m.role_id
     WHERE e.company_id = p_company) END,
    'departamentos', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]') FROM departments WHERE company_id = p_company),
    'filiais', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]') FROM branches WHERE company_id = p_company),
    'horarios', (SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]') FROM work_schedules WHERE company_id = p_company),
    'responsavel', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', u.name,
                       'ultimaEntrada', to_char(u.last_login_at AT TIME ZONE ps_company_tz(p_company), 'DD/MM HH24:MI'))), '[]')
                    FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
                    WHERE m.company_id = p_company AND m.active AND r.code = 'owner'),
    'emailDaEmpresa', (SELECT email FROM companies WHERE id = p_company)
  );
END $$;

-- 2. Aviso ao responsável: notificação no Horbit (sino) e lista de emails reais para a Edge Function enviar.
CREATE OR REPLACE FUNCTION ps_ai_notify_owner(p_company uuid, p_subject text, p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int; v_emails jsonb; v_subject text := left(trim(COALESCE(p_subject, '')), 150); v_body text := left(trim(COALESCE(p_body, '')), 4000);
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'ai.use'), 'Sem acesso ao assistente.');
  IF v_subject = '' OR v_body = '' THEN RAISE EXCEPTION 'Indique o assunto e a mensagem.' USING ERRCODE = '22023'; END IF;
  INSERT INTO notifications (company_id, user_id, kind, title, body, link)
  SELECT p_company, m.user_id, 'assistant', v_subject, v_body, '/empresa/assistente/'
    FROM memberships m JOIN roles r ON r.id = m.role_id
   WHERE m.company_id = p_company AND m.active AND r.code = 'owner';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT COALESCE(jsonb_agg(DISTINCT x), '[]') INTO v_emails FROM (
    SELECT lower(email) AS x FROM companies WHERE id = p_company AND email LIKE '%@%'
    UNION SELECT lower(u.email) FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
           WHERE m.company_id = p_company AND m.active AND r.code = 'owner' AND u.email NOT LIKE '%@pontosmart.app'
    UNION SELECT lower(e.email) FROM memberships m JOIN roles r ON r.id = m.role_id JOIN employees e ON e.user_id = m.user_id AND e.company_id = m.company_id
           WHERE m.company_id = p_company AND m.active AND r.code = 'owner' AND e.email LIKE '%@%') t WHERE x ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  PERFORM ps_audit_log(p_company, 'ai.owner_notified', 'company', p_company::text, NULL, jsonb_build_object('subject', v_subject));
  RETURN jsonb_build_object('notified', v_n, 'emails', v_emails, 'company', (SELECT name FROM companies WHERE id = p_company));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_ai_context_extra(uuid)', 'ps_ai_notify_owner(uuid, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
