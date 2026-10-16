-- Horbit, script 4, parte 15: envio de emails por SMTP com uma única conta (ex.: Gmail + palavra-passe de app).
-- Configura-se uma vez em Plataforma → Emails; o Horbit envia sozinho as credenciais e os avisos a todos.
-- Requer a parte 14. Pode ser executado de novo sem problema.
BEGIN;

-- Configuração completa (só a Edge Function a lê, com a chave de serviço).
CREATE OR REPLACE FUNCTION ps_mail_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'url', (SELECT value FROM ps_secrets WHERE key = 'mail_script_url'),
    'secret', (SELECT value FROM ps_secrets WHERE key = 'mail_script_secret'),
    'from', COALESCE((SELECT value FROM ps_secrets WHERE key = 'mail_from_name'), 'Horbit'),
    'smtpHost', COALESCE((SELECT value FROM ps_secrets WHERE key = 'smtp_host'), 'smtp.gmail.com'),
    'smtpPort', COALESCE((SELECT value FROM ps_secrets WHERE key = 'smtp_port'), '465')::int,
    'smtpUser', (SELECT value FROM ps_secrets WHERE key = 'smtp_user'),
    'smtpPass', (SELECT value FROM ps_secrets WHERE key = 'smtp_pass'))
$$;
REVOKE ALL ON FUNCTION ps_mail_config() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION ps_mail_config() FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION ps_mail_config() FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ps_mail_config() TO service_role'; END IF;
END $$;

-- Painel do Super Admin (a palavra-passe nunca volta ao navegador: só se diz se existe).
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
    'smtpHost', COALESCE((SELECT value FROM ps_secrets WHERE key = 'smtp_host'), 'smtp.gmail.com'),
    'smtpPort', COALESCE((SELECT value FROM ps_secrets WHERE key = 'smtp_port'), '465')::int,
    'smtpUser', (SELECT value FROM ps_secrets WHERE key = 'smtp_user'),
    'smtpHasPass', EXISTS (SELECT 1 FROM ps_secrets WHERE key = 'smtp_pass'),
    'sentToday', COALESCE((SELECT sum(count) FROM rate_limits WHERE key LIKE 'mail:%:' || current_date), 0));
END $$;

-- Guarda a conta SMTP. p_pass NULL ou vazio mantém a palavra-passe guardada; p_user vazio desliga o SMTP.
CREATE OR REPLACE FUNCTION ps_mail_smtp_set(p_user text, p_pass text DEFAULT NULL, p_host text DEFAULT NULL, p_port integer DEFAULT NULL, p_from_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user text := lower(NULLIF(trim(COALESCE(p_user, '')), '')); v_pass text := NULLIF(replace(COALESCE(p_pass, ''), ' ', ''), '');
  v_host text := lower(COALESCE(NULLIF(trim(COALESCE(p_host, '')), ''), 'smtp.gmail.com')); v_port int := COALESCE(p_port, 465);
BEGIN
  PERFORM ps_require(ps_is_platform_admin(), 'Só o Super Admin configura o envio de emails.');
  IF v_user IS NULL THEN
    DELETE FROM ps_secrets WHERE key IN ('smtp_user', 'smtp_pass');
  ELSE
    IF v_user !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Escreva o email que vai enviar (ex.: horbit.mz@gmail.com).' USING ERRCODE = '22023'; END IF;
    IF v_host !~ '^[a-z0-9.-]+\.[a-z]{2,}$' THEN RAISE EXCEPTION 'Servidor SMTP inválido.' USING ERRCODE = '22023'; END IF;
    IF v_port NOT IN (465, 2465, 2525, 587, 25) THEN RAISE EXCEPTION 'Porta inválida (use 465).' USING ERRCODE = '22023'; END IF;
    IF v_pass IS NULL AND NOT EXISTS (SELECT 1 FROM ps_secrets WHERE key = 'smtp_pass') THEN
      RAISE EXCEPTION 'Escreva a palavra-passe de app.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO ps_secrets (key, value) VALUES ('smtp_user', v_user), ('smtp_host', v_host), ('smtp_port', v_port::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    IF v_pass IS NOT NULL THEN
      INSERT INTO ps_secrets (key, value) VALUES ('smtp_pass', v_pass) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_from_name, '')), '') IS NOT NULL THEN
    INSERT INTO ps_secrets (key, value) VALUES ('mail_from_name', left(trim(p_from_name), 60)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  PERFORM ps_audit_log(NULL, 'platform.mail_settings', 'platform', 'mail', NULL, jsonb_build_object('smtp', v_user IS NOT NULL, 'user', v_user));
  RETURN ps_mail_settings();
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_mail_settings()', 'ps_mail_smtp_set(text, text, text, integer, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
