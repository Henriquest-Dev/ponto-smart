-- Horbit, script 4, parte 6: assistente do Super Admin e pedido de conta simplificado
-- Pode ser executado de novo sem problema.
BEGIN;

-- Conversas do Super Admin não pertencem a nenhuma empresa.
ALTER TABLE ai_conversations ALTER COLUMN company_id DROP NOT NULL;
DROP POLICY IF EXISTS ps_own ON ai_conversations;
CREATE POLICY ps_own ON ai_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND (
    (company_id IS NULL AND ps_is_platform_admin()) OR (company_id IS NOT NULL AND ps_has_perm(company_id, 'ai.use'))));

-- Resumo da plataforma para o assistente do Super Admin (sem salários das empresas).
CREATE OR REPLACE FUNCTION ps_ai_platform_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Maputo')::date; v jsonb;
BEGIN
  PERFORM ps_require(ps_is_platform_admin(), 'Apenas o Super Admin pode usar este assistente.');
  SELECT jsonb_build_object(
    'hoje', v_today,
    'papel', 'Super Admin da plataforma',
    'empresas', (SELECT COALESCE(jsonb_agg(x ORDER BY x.criada DESC), '[]') FROM (
        SELECT c.name AS nome, c.status AS estado, c.created_at::date AS criada, c.email, c.phone AS telefone,
               (SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.status = 'active') AS colaboradores,
               (SELECT u.email FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
                 WHERE m.company_id = c.id AND r.code = 'owner' ORDER BY m.created_at LIMIT 1) AS responsavel,
               (SELECT max(ev.occurred_at) FROM attendance_events ev WHERE ev.company_id = c.id) AS ultima_marcacao,
               (SELECT count(*) FROM attendance_events ev WHERE ev.company_id = c.id AND ev.work_date > v_today - 30) AS marcacoes_30dias,
               (SELECT count(*) FROM attendance_events ev WHERE ev.company_id = c.id AND ev.status = 'review') AS marcacoes_em_revisao,
               (SELECT count(*) FROM absence_requests a WHERE a.company_id = c.id AND a.status = 'pending') AS justificacoes_pendentes
          FROM companies c) x),
    'pedidosDeConta', (SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', q.company_name, 'contacto', q.contact_name,
                          'email', q.email, 'telefone', q.phone, 'cidade', q.city, 'colaboradores', q.employees_estimate,
                          'estado', q.status, 'recebido', q.created_at) ORDER BY q.created_at DESC), '[]')
                         FROM (SELECT * FROM company_requests ORDER BY created_at DESC LIMIT 30) q),
    'marcacoesPorDia', (SELECT COALESCE(jsonb_agg(jsonb_build_object('dia', d::date, 'marcacoes', COALESCE(n.c, 0), 'empresas', COALESCE(n.k, 0)) ORDER BY d), '[]')
                          FROM generate_series(v_today - 13, v_today, interval '1 day') d
                          LEFT JOIN (SELECT work_date, count(*) c, count(DISTINCT company_id) k FROM attendance_events
                                      WHERE work_date > v_today - 14 GROUP BY work_date) n ON n.work_date = d::date),
    'auditoriaRecente', (SELECT COALESCE(jsonb_agg(jsonb_build_object('quando', a.created_at, 'accao', a.action,
                            'empresa', (SELECT name FROM companies WHERE id = a.company_id))), '[]')
                           FROM (SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 25) a)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION ps_ai_platform_context() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION ps_ai_platform_context() FROM anon; END IF;
END $$;
GRANT EXECUTE ON FUNCTION ps_ai_platform_context() TO authenticated;

-- Pedido de conta simplificado: só nome da empresa, email e motivo.
ALTER TABLE company_requests ALTER COLUMN contact_name DROP NOT NULL;
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
GRANT EXECUTE ON FUNCTION ps_submit_company_request(text, text, text, text, text, text, integer, text, text) TO anon, authenticated;

COMMIT;
