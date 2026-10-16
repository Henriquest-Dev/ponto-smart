-- Horbit, script 4, parte 14: envio automático de emails pelo Gmail da empresa-mãe (Google Apps Script, sem SMTP).
-- O Super Admin cola o endereço do Apps Script em Plataforma → Emails; o Horbit envia as credenciais e os avisos.
-- Pode ser executado de novo sem problema.
BEGIN;

-- Configuração (só a Edge Function a lê, com a chave de serviço; o Super Admin vê e altera pelo painel).
CREATE OR REPLACE FUNCTION ps_mail_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('url', (SELECT value FROM ps_secrets WHERE key = 'mail_script_url'),
                            'secret', (SELECT value FROM ps_secrets WHERE key = 'mail_script_secret'),
                            'from', COALESCE((SELECT value FROM ps_secrets WHERE key = 'mail_from_name'), 'Horbit'))
$$;
REVOKE ALL ON FUNCTION ps_mail_config() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION ps_mail_config() FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION ps_mail_config() FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ps_mail_config() TO service_role'; END IF;
END $$;

-- Painel do Super Admin: ver a configuração (cria o segredo na primeira vez).
CREATE OR REPLACE FUNCTION ps_mail_settings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_is_platform_admin(), 'Só o Super Admin configura o envio de emails.');
  INSERT INTO ps_secrets (key, value)
  VALUES ('mail_script_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  ON CONFLICT (key) DO NOTHING;
  RETURN jsonb_build_object(
    'url', (SELECT value FROM ps_secrets WHERE key = 'mail_script_url'),
    'secret', (SELECT value FROM ps_secrets WHERE key = 'mail_script_secret'),
    'fromName', COALESCE((SELECT value FROM ps_secrets WHERE key = 'mail_from_name'), 'Horbit'),
    'sentToday', COALESCE((SELECT sum(count) FROM rate_limits WHERE key LIKE 'mail:%:' || current_date), 0));
END $$;

CREATE OR REPLACE FUNCTION ps_mail_settings_set(p_url text, p_from_name text DEFAULT NULL, p_new_secret boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_url text := NULLIF(trim(COALESCE(p_url, '')), '');
BEGIN
  PERFORM ps_require(ps_is_platform_admin(), 'Só o Super Admin configura o envio de emails.');
  IF v_url IS NOT NULL AND v_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' THEN
    RAISE EXCEPTION 'O endereço deve ser o da aplicação web do Apps Script (https://script.google.com/macros/s/…/exec).' USING ERRCODE = '22023';
  END IF;
  IF v_url IS NULL THEN DELETE FROM ps_secrets WHERE key = 'mail_script_url';
  ELSE INSERT INTO ps_secrets (key, value) VALUES ('mail_script_url', v_url) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF NULLIF(trim(COALESCE(p_from_name, '')), '') IS NOT NULL THEN
    INSERT INTO ps_secrets (key, value) VALUES ('mail_from_name', left(trim(p_from_name), 60)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF p_new_secret THEN
    INSERT INTO ps_secrets (key, value) VALUES ('mail_script_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  PERFORM ps_audit_log(NULL, 'platform.mail_settings', 'platform', 'mail', NULL, jsonb_build_object('configured', v_url IS NOT NULL));
  RETURN ps_mail_settings();
END $$;

-- Quem pode enviar para quem: o Super Admin para qualquer email; na empresa, quem gere colaboradores (ou o assistente
-- a avisar o responsável) só para emails da própria empresa (colaboradores, email da empresa, responsáveis).
-- Conta os envios do dia (máximo 300 por pessoa).
CREATE OR REPLACE FUNCTION ps_mail_authorize(p_company uuid, p_emails text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emails text[]; v_bad text; v_count int; v_key text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada. Entre novamente.' USING ERRCODE = '28000'; END IF;
  SELECT array_agg(DISTINCT lower(trim(e))) INTO v_emails FROM unnest(COALESCE(p_emails, '{}')) e WHERE trim(e) <> '';
  IF v_emails IS NULL THEN RAISE EXCEPTION 'Sem destinatário.' USING ERRCODE = '22023'; END IF;
  IF cardinality(v_emails) > 50 THEN RAISE EXCEPTION 'No máximo 50 destinatários de cada vez.' USING ERRCODE = '22023'; END IF;
  SELECT e INTO v_bad FROM unnest(v_emails) e WHERE e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Email inválido: %', v_bad USING ERRCODE = '22023'; END IF;
  IF NOT ps_is_platform_admin() THEN
    PERFORM ps_require(p_company IS NOT NULL AND (ps_has_perm(p_company, 'employees.manage') OR ps_has_perm(p_company, 'ai.use')),
                       'Sem permissão para enviar emails.');
    SELECT e INTO v_bad FROM unnest(v_emails) e
     WHERE NOT EXISTS (SELECT 1 FROM employees WHERE company_id = p_company AND lower(email) = e)
       AND NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company AND lower(email) = e)
       AND NOT EXISTS (SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id JOIN users u ON u.id = m.user_id
                        WHERE m.company_id = p_company AND r.code IN ('owner', 'admin') AND lower(u.email) = e)
     LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'O email % não é de nenhum colaborador desta empresa. Escreva-o primeiro na ficha do colaborador.', v_bad USING ERRCODE = '42501';
    END IF;
  END IF;
  v_key := 'mail:' || auth.uid() || ':' || current_date;
  INSERT INTO rate_limits (key, window_start, count) VALUES (v_key, now(), cardinality(v_emails))
  ON CONFLICT (key) DO UPDATE SET count = rate_limits.count + cardinality(v_emails) RETURNING count INTO v_count;
  IF v_count > 300 THEN RAISE EXCEPTION 'Limite de emails de hoje atingido. Tente amanhã.' USING ERRCODE = '54000'; END IF;
  RETURN 300 - v_count;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_mail_settings()', 'ps_mail_settings_set(text, text, boolean)', 'ps_mail_authorize(uuid, text[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
