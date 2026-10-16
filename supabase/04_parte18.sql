-- Horbit, script 4, parte 18: lembretes e agendamentos por email, e envios automáticos a sério.
-- O Orbi (ou a pessoa) cria lembretes: uma vez, todos os dias, todas as semanas ou todos os meses, por email.
-- Um relógio no próprio Supabase (pg_cron + pg_net) chama a função Ponto-ai de 10 em 10 minutos: envia os lembretes
-- que chegaram à hora e o resumo mensal de cada empresa, sem depender de alguém abrir o Horbit.
-- Requer as partes 14 a 16. Pode ser executado de novo sem problema.
BEGIN;

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies (id) ON DELETE CASCADE,
  created_by uuid,
  title text NOT NULL,
  message text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  next_at timestamptz NOT NULL,
  repeat text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly')),
  active boolean NOT NULL DEFAULT true,
  sent_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (next_at) WHERE active;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reminders FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON reminders FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON reminders FROM authenticated'; END IF;
END $$;

-- Quem pode gerir lembretes: o Super Admin (company NULL) ou, na empresa, quem gere colaboradores ou usa o assistente.
CREATE OR REPLACE FUNCTION ps_reminder_ok(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_company IS NULL THEN ps_is_platform_admin()
              ELSE ps_has_perm(p_company, 'employees.manage') OR ps_has_perm(p_company, 'ai.use') END
$$;

-- p: {title, message, when ("AAAA-MM-DDTHH:MM", hora local da empresa / Maputo), repeat, recipients[]}
CREATE OR REPLACE FUNCTION ps_reminder_save(p_company uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_title text := left(trim(COALESCE(p ->> 'title', '')), 150); v_msg text := left(trim(COALESCE(p ->> 'message', '')), 8000);
  v_repeat text := COALESCE(NULLIF(p ->> 'repeat', ''), 'none'); v_when timestamptz; v_to text[]; v_bad text;
  v_tz text := CASE WHEN p_company IS NULL THEN 'Africa/Maputo' ELSE ps_company_tz(p_company) END;
BEGIN
  PERFORM ps_require(ps_reminder_ok(p_company), 'Sem permissão para criar lembretes.');
  IF length(v_title) < 2 THEN RAISE EXCEPTION 'Dê um título ao lembrete.' USING ERRCODE = '22023'; END IF;
  IF length(v_msg) < 2 THEN v_msg := v_title; END IF;
  IF v_repeat NOT IN ('none', 'daily', 'weekly', 'monthly') THEN RAISE EXCEPTION 'Repetição inválida.' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_when := (p ->> 'when')::timestamp AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Indique o dia e a hora do lembrete.' USING ERRCODE = '22023';
  END;
  IF v_when IS NULL THEN RAISE EXCEPTION 'Indique o dia e a hora do lembrete.' USING ERRCODE = '22023'; END IF;
  IF v_when < now() - interval '5 minutes' AND v_repeat = 'none' THEN RAISE EXCEPTION 'Essa hora já passou.' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(trim(e))), '{}') INTO v_to
    FROM jsonb_array_elements_text(COALESCE(p -> 'recipients', '[]')) e WHERE trim(e) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  IF p_company IS NOT NULL THEN
    IF cardinality(v_to) = 0 THEN v_to := ps_owner_emails(p_company); END IF;
    SELECT e INTO v_bad FROM unnest(v_to) e
     WHERE NOT (e = ANY (ps_owner_emails(p_company)))
       AND NOT EXISTS (SELECT 1 FROM employees WHERE company_id = p_company AND lower(email) = e)
       AND NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = p_company AND lower(u.email) = e)
     LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'O email % não é desta empresa.', v_bad USING ERRCODE = '42501'; END IF;
    IF cardinality(v_to) = 0 THEN RAISE EXCEPTION 'A empresa não tem email registado para receber o lembrete.' USING ERRCODE = '22023'; END IF;
  END IF;
  -- Lembretes repetidos que comecem no passado avançam até à próxima vez.
  WHILE v_when < now() AND v_repeat <> 'none' LOOP
    v_when := v_when + CASE v_repeat WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END;
  END LOOP;
  INSERT INTO reminders (company_id, created_by, title, message, recipients, next_at, repeat)
  VALUES (p_company, auth.uid(), v_title, v_msg, v_to, v_when, v_repeat) RETURNING id INTO v_id;
  PERFORM ps_audit_log(p_company, 'reminder.create', 'reminder', v_id::text, NULL, jsonb_build_object('title', v_title, 'repeat', v_repeat));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_reminders(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_reminder_ok(p_company));
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'message', r.message, 'recipients', to_jsonb(r.recipients),
             'nextAt', r.next_at, 'repeat', r.repeat, 'active', r.active, 'sentCount', r.sent_count, 'lastSentAt', r.last_sent_at,
             'lastError', r.last_error, 'by', (SELECT name FROM users WHERE id = r.created_by)) ORDER BY r.active DESC, r.next_at)
      FROM reminders r WHERE r.company_id IS NOT DISTINCT FROM p_company AND (r.active OR r.last_sent_at > now() - interval '30 days')), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION ps_reminder_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r reminders;
BEGIN
  SELECT * INTO r FROM reminders WHERE id = p_id;
  PERFORM ps_require(r.id IS NOT NULL AND ps_reminder_ok(r.company_id));
  DELETE FROM reminders WHERE id = p_id;
END $$;

-- Só a função (chave de serviço): os lembretes que chegaram à hora. Marca-os já (avança a próxima vez ou desliga).
CREATE OR REPLACE FUNCTION ps_reminders_take_due() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH due AS (
    SELECT id FROM reminders WHERE active AND next_at <= now() ORDER BY next_at LIMIT 50 FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE reminders r SET
      sent_count = r.sent_count + 1,
      last_sent_at = now(),
      active = r.repeat <> 'none',
      next_at = CASE r.repeat WHEN 'daily' THEN r.next_at + interval '1 day' WHEN 'weekly' THEN r.next_at + interval '7 days'
                              WHEN 'monthly' THEN r.next_at + interval '1 month' ELSE r.next_at END
    FROM due WHERE r.id = due.id
    RETURNING r.id, r.company_id, r.title, r.message, r.recipients, r.repeat
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'companyId', company_id, 'title', title, 'message', message,
                                               'recipients', to_jsonb(recipients), 'repeat', repeat)), '[]') INTO v FROM upd;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION ps_reminder_failed(p_id uuid, p_error text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE reminders SET last_error = left(p_error, 300) WHERE id = p_id;
$$;

-- Empresas cujo resumo do mês anterior ainda não saiu (para o relógio automático).
CREATE OR REPLACE FUNCTION ps_monthly_reports_due() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('companyId', c.id, 'month', to_char((now() AT TIME ZONE c.timezone)::date - interval '1 month', 'YYYY-MM'))), '[]')
    FROM companies c
   WHERE c.status IN ('trial', 'active')
     AND COALESCE((c.settings ->> 'monthlyReport')::boolean, true)
     AND c.created_at < date_trunc('month', now())
     AND NOT EXISTS (SELECT 1 FROM monthly_reports m WHERE m.company_id = c.id
                       AND m.month = to_char((now() AT TIME ZONE c.timezone)::date - interval '1 month', 'YYYY-MM'))
     AND cardinality(ps_owner_emails(c.id)) > 0
$$;

-- Segredo do relógio (o pg_cron envia-o; a função confere-o).
INSERT INTO ps_secrets (key, value) VALUES ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;
CREATE OR REPLACE FUNCTION ps_cron_secret() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT value FROM ps_secrets WHERE key = 'cron_secret'
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_reminder_ok(uuid)', 'ps_reminder_save(uuid, jsonb)', 'ps_reminders(uuid)', 'ps_reminder_delete(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['ps_reminders_take_due()', 'ps_reminder_failed(uuid, text)', 'ps_monthly_reports_due()', 'ps_cron_secret()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
  END LOOP;
END $$;

COMMIT;

-- Relógio automático (fora da transacção: as extensões são do Supabase).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Active as extensões pg_cron e pg_net em Database > Extensions e corra de novo este script (%).', SQLERRM;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'horbit-lembretes';
    PERFORM cron.schedule('horbit-lembretes', '*/10 * * * *', $job$
      SELECT net.http_post(
        url := 'https://tbblsxwqclpujebzbpiu.supabase.co/functions/v1/Ponto-ai',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (SELECT value FROM public.ps_secrets WHERE key = 'cron_secret')),
        body := '{"mode":"cron"}'::jsonb,
        timeout_milliseconds := 60000)
    $job$);
  END IF;
END $$;
