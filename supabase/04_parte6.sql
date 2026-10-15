-- Horbit, script 4, parte 6: assistente também para o Super Admin
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

COMMIT;
