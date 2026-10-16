-- Horbit, script 4, parte 7: QR Code fixo da empresa, marcação por link em dias especiais e auditoria sem ruído
-- Pode ser executado de novo sem problema.
BEGIN;

-- 1. Auditoria: a estação aberta na recepção actualiza "visto em" a cada 30 s; isso não é uma acção de ninguém.
CREATE OR REPLACE FUNCTION ps_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;  -- tarefas internas não geram ruído
  IF TG_OP = 'UPDATE' AND (v_old - 'last_seen_at' - 'updated_at' - 'static_token' - 'static_token_hash')
                        = (v_new - 'last_seen_at' - 'updated_at' - 'static_token' - 'static_token_hash') THEN
    RETURN NEW;  -- só mudou "visto em", "actualizado em" ou o código do QR (este tem registo próprio)
  END IF;
  IF TG_TABLE_NAME = 'companies' THEN v_company := COALESCE(NEW.id, OLD.id);
  ELSE v_company := COALESCE(v_new ->> 'company_id', v_old ->> 'company_id')::uuid; END IF;
  INSERT INTO audit_logs (company_id, actor_id, action, entity, entity_id, before, after)
  VALUES (v_company, auth.uid(), TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
          COALESCE(v_new ->> 'id', v_old ->> 'id'),
          v_old - 'static_token' - 'static_token_hash', v_new - 'static_token' - 'static_token_hash');
  RETURN COALESCE(NEW, OLD);
END $$;
-- Os registos antigos ficam (a auditoria é só de acréscimo); esta vista esconde-os nos ecrãs de Auditoria.
CREATE OR REPLACE VIEW audit_log_clean WITH (security_invoker = true) AS
  SELECT * FROM audit_logs
   WHERE NOT (action = 'attendance_stations.update'
              AND (before - 'last_seen_at' - 'updated_at') = (after - 'last_seen_at' - 'updated_at'));
GRANT SELECT ON audit_log_clean TO authenticated;

-- 2. QR Code fixo: o código fica guardado (para voltar a mostrar e imprimir) e pode ter horário de validade.
ALTER TABLE attendance_stations ADD COLUMN IF NOT EXISTS static_token text;
ALTER TABLE attendance_stations ADD COLUMN IF NOT EXISTS window_start time;
ALTER TABLE attendance_stations ADD COLUMN IF NOT EXISTS window_end time;
GRANT SELECT (window_start, window_end) ON attendance_stations TO authenticated;

CREATE OR REPLACE FUNCTION ps_station_fixed_qr(p_station uuid, p_new boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'locations.manage'), 'Sem permissão para gerir o QR Code.');
  v_token := v_st.static_token;
  IF v_token IS NULL OR p_new THEN
    v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
    UPDATE attendance_stations SET qr_mode = 'static', static_token = v_token,
           static_token_hash = encode(digest(v_token, 'sha256'), 'hex')
     WHERE id = v_st.id;
    PERFORM ps_audit_log(v_st.company_id, CASE WHEN v_st.static_token IS NULL THEN 'qr.created' ELSE 'qr.regenerated' END,
                         'attendance_station', v_st.id::text, NULL, jsonb_build_object('station', v_st.name));
  ELSIF v_st.qr_mode <> 'static' THEN
    UPDATE attendance_stations SET qr_mode = 'static' WHERE id = v_st.id;
  END IF;
  RETURN jsonb_build_object('token', v_token, 'station', v_st.name,
    'location', (SELECT name FROM work_locations WHERE id = v_st.location_id),
    'company', (SELECT name FROM companies WHERE id = v_st.company_id),
    'windowStart', to_char(v_st.window_start, 'HH24:MI'), 'windowEnd', to_char(v_st.window_end, 'HH24:MI'));
END $$;

CREATE OR REPLACE FUNCTION ps_station_set_window(p_station uuid, p_start time, p_end time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_st attendance_stations;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'locations.manage'), 'Sem permissão para gerir o QR Code.');
  IF (p_start IS NULL) <> (p_end IS NULL) THEN RAISE EXCEPTION 'Indique a hora de início e a hora de fim.' USING ERRCODE = '22023'; END IF;
  IF p_start IS NOT NULL AND p_end <= p_start THEN RAISE EXCEPTION 'A hora de fim tem de ser depois da hora de início.' USING ERRCODE = '22023'; END IF;
  -- O registo na auditoria é feito pelo gatilho da tabela (alteração das horas do QR Code).
  UPDATE attendance_stations SET window_start = p_start, window_end = p_end WHERE id = v_st.id;
END $$;

-- 3. Marcação por link (dias especiais): janela com data e horas em que o botão aparece aos colaboradores.
CREATE TABLE IF NOT EXISTS clock_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES work_locations(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  note text,
  require_gps boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clock_links_company_date_idx ON clock_links (company_id, work_date);
ALTER TABLE clock_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ps_member_read ON clock_links;
CREATE POLICY ps_member_read ON clock_links FOR SELECT TO authenticated USING (ps_is_member(company_id));
REVOKE ALL ON clock_links FROM anon, authenticated;
GRANT SELECT ON clock_links TO authenticated;

CREATE OR REPLACE FUNCTION ps_clock_link_save(p_company uuid, p_id uuid, p_location uuid, p_date date, p_start time, p_end time,
                                              p_note text DEFAULT NULL, p_require_gps boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'locations.manage') OR ps_has_perm(p_company, 'attendance.manage'),
                     'Sem permissão para criar marcações por link.');
  IF NOT EXISTS (SELECT 1 FROM work_locations WHERE id = p_location AND company_id = p_company) THEN
    RAISE EXCEPTION 'Escolha o local de trabalho.' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_start IS NULL OR p_end IS NULL THEN RAISE EXCEPTION 'Indique o dia e as horas.' USING ERRCODE = '22023'; END IF;
  IF p_end <= p_start THEN RAISE EXCEPTION 'A hora de fim tem de ser depois da hora de início.' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO clock_links (company_id, location_id, work_date, start_time, end_time, note, require_gps, created_by)
    VALUES (p_company, p_location, p_date, p_start, p_end, NULLIF(left(trim(p_note), 200), ''), COALESCE(p_require_gps, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE clock_links SET location_id = p_location, work_date = p_date, start_time = p_start, end_time = p_end,
           note = NULLIF(left(trim(p_note), 200), ''), require_gps = COALESCE(p_require_gps, true)
     WHERE id = p_id AND company_id = p_company RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Marcação por link não encontrada.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  PERFORM ps_audit_log(p_company, CASE WHEN p_id IS NULL THEN 'clock_link.created' ELSE 'clock_link.updated' END, 'clock_link', v_id::text, NULL,
                       jsonb_build_object('date', p_date, 'start', to_char(p_start, 'HH24:MI'), 'end', to_char(p_end, 'HH24:MI'), 'note', p_note));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_clock_link_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_l clock_links;
BEGIN
  SELECT * INTO v_l FROM clock_links WHERE id = p_id;
  PERFORM ps_require(v_l.id IS NOT NULL AND (ps_has_perm(v_l.company_id, 'locations.manage') OR ps_has_perm(v_l.company_id, 'attendance.manage')));
  DELETE FROM clock_links WHERE id = p_id;
  PERFORM ps_audit_log(v_l.company_id, 'clock_link.deleted', 'clock_link', p_id::text,
                       jsonb_build_object('date', v_l.work_date, 'start', to_char(v_l.start_time, 'HH24:MI'), 'end', to_char(v_l.end_time, 'HH24:MI')), NULL);
END $$;

-- Links de hoje para o colaborador (com indicação se já estão abertos).
CREATE OR REPLACE FUNCTION ps_my_clock_links(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text := ps_company_tz(p_company); v_local timestamp := now() AT TIME ZONE ps_company_tz(p_company);
BEGIN
  PERFORM ps_require(ps_my_employee(p_company) IS NOT NULL, 'Não tem ficha de colaborador nesta empresa.');
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', l.id, 'date', l.work_date, 'start', to_char(l.start_time, 'HH24:MI'), 'end', to_char(l.end_time, 'HH24:MI'),
            'note', l.note, 'location', w.name, 'requireGps', l.require_gps,
            'open', v_local::time BETWEEN l.start_time AND l.end_time) ORDER BY l.start_time), '[]')
            FROM clock_links l JOIN work_locations w ON w.id = l.location_id
           WHERE l.company_id = p_company AND l.active AND l.work_date = v_local::date AND v_local::time <= l.end_time);
END $$;

-- 4. Núcleo comum da marcação (QR ou link). Não é chamado directamente pelo navegador.
CREATE OR REPLACE FUNCTION ps_clock_apply(
  p_station uuid, p_location uuid, p_mode text, p_require_gps boolean,
  p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_idempotency text, p_device_key text, p_requested text, p_request_review boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_loc work_locations; v_emp employees; v_company companies; v_settings jsonb; v_tz text;
  v_outside double precision; v_center double precision; v_geo geofence_result; v_geo_msg text;
  v_device device_result := 'not_required'; v_device_id uuid; v_status attendance_event_status := 'accepted';
  v_reasons text[] := '{}'; v_prior record; v_last record; v_type attendance_event_type; v_work_date date;
  v_event uuid; v_now timestamptz := now(); v_msg text; v_window int; v_worked int;
BEGIN
  SELECT * INTO v_loc FROM work_locations WHERE id = p_location;
  SELECT * INTO v_emp FROM employees WHERE user_id = auth.uid() AND company_id = v_loc.company_id AND status = 'active';
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Este QR Code pertence a outra empresa.' USING ERRCODE = '42501'; END IF;
  PERFORM ps_require(ps_has_perm(v_loc.company_id, 'self.clock'), 'Sem permissão para marcar ponto.');
  IF NOT v_loc.active THEN RAISE EXCEPTION 'Local de marcação inactivo.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_company FROM companies WHERE id = v_loc.company_id;
  v_settings := v_company.settings; v_tz := v_company.timezone;
  SELECT ev.id, ev.type, ev.status, ev.occurred_at, ev.work_date, va.geofence_result, va.device_result INTO v_prior
    FROM attendance_events ev LEFT JOIN attendance_validations va ON va.event_id = ev.id
   WHERE ev.employee_id = v_emp.id AND ev.idempotency_key = p_idempotency LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('eventId', v_prior.id, 'type', v_prior.type, 'status', v_prior.status, 'occurredAt', v_prior.occurred_at,
      'geofence', COALESCE(v_prior.geofence_result::text, 'unavailable'), 'device', COALESCE(v_prior.device_result::text, 'not_required'),
      'message', 'Pedido já processado.', 'duplicate', true,
      'workedMinutes', (SELECT worked_minutes FROM attendance_daily WHERE employee_id = v_emp.id AND work_date = v_prior.work_date));
  END IF;
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT CASE WHEN l.geom IS NOT NULL
                THEN CASE WHEN ST_Covers(l.geom, g) THEN 0 ELSE ST_Distance(l.geom, g) END
                ELSE ST_Distance(l.center, g) - l.radius_m END,
           ST_Distance(l.center, g)
      INTO v_outside, v_center
      FROM work_locations l, (SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS g) p
     WHERE l.id = v_loc.id;
  END IF;
  IF v_outside IS NULL OR p_accuracy IS NULL THEN
    v_geo := 'unavailable'; v_geo_msg := 'Localização indisponível. A marcação fica em revisão.';
  ELSIF p_accuracy > v_loc.max_accuracy_m THEN
    v_geo := 'inconclusive'; v_geo_msg := format('Precisão GPS insuficiente (±%s m). Tente novamente ao ar livre ou peça revisão.', round(p_accuracy));
  ELSIF v_outside <= 0 THEN
    v_geo := 'inside'; v_geo_msg := 'Dentro do perímetro autorizado.';
  ELSIF v_outside <= p_accuracy THEN
    v_geo := 'inconclusive'; v_geo_msg := 'Muito perto do limite do local para concluir. Tente novamente ou peça revisão.';
  ELSE
    v_geo := 'outside'; v_geo_msg := format('Fora do perímetro autorizado (a cerca de %s m).', round(v_outside));
  END IF;
  IF COALESCE(v_settings ->> 'devicePolicy', 'warn') <> 'off' THEN
    v_device := 'unknown';
    IF p_device_key IS NOT NULL THEN
      SELECT id, CASE WHEN revoked_at IS NULL THEN 'trusted' ELSE 'revoked' END::device_result INTO v_device_id, v_device
        FROM trusted_devices WHERE employee_id = v_emp.id AND credential_id = encode(digest(p_device_key, 'sha256'), 'hex') LIMIT 1;
      IF v_device_id IS NULL THEN v_device := 'unknown'; END IF;
    END IF;
  END IF;
  IF p_require_gps THEN
    IF v_geo = 'outside' THEN
      IF p_request_review THEN v_status := 'review'; v_reasons := v_reasons || 'Fora do perímetro — revisão pedida pelo colaborador.';
      ELSE v_status := 'rejected'; END IF;
    ELSIF v_geo <> 'inside' THEN
      v_status := 'review'; v_reasons := v_reasons || v_geo_msg;
    END IF;
  END IF;
  IF v_settings ->> 'devicePolicy' = 'require' AND v_device <> 'trusted' AND v_status = 'accepted' THEN
    v_status := 'review'; v_reasons := v_reasons || 'Dispositivo não reconhecido como de confiança.'::text;
  END IF;
  IF p_mode = 'link' THEN v_reasons := v_reasons || 'Marcação por link (dia especial).'::text; END IF;
  IF NULLIF(trim(p_note), '') IS NOT NULL THEN v_reasons := v_reasons || ('Nota do colaborador: ' || left(p_note, 300)); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_emp.id::text));
  SELECT id, type, occurred_at, work_date, status INTO v_last FROM attendance_events
   WHERE employee_id = v_emp.id AND status <> 'rejected' AND occurred_at >= v_now - interval '20 hours'
   ORDER BY occurred_at DESC LIMIT 1;
  v_window := COALESCE((v_settings ->> 'duplicateWindowMinutes')::int, 2);
  IF v_last.id IS NOT NULL AND v_status <> 'rejected' AND v_now - v_last.occurred_at < make_interval(mins => v_window) THEN
    RETURN jsonb_build_object('eventId', v_last.id, 'type', v_last.type, 'status', v_last.status, 'occurredAt', v_last.occurred_at,
      'geofence', v_geo, 'device', v_device, 'message', 'Marcação já registada há instantes. Não foi criada nova marcação.', 'duplicate', true,
      'workedMinutes', (SELECT worked_minutes FROM attendance_daily WHERE employee_id = v_emp.id AND work_date = v_last.work_date));
  END IF;
  v_type := CASE
    WHEN v_last.id IS NULL OR v_last.type = 'out' THEN 'in'
    WHEN v_last.type = 'break_start' THEN 'break_end'
    WHEN p_requested = 'break_start' THEN 'break_start'
    ELSE 'out' END;
  v_work_date := CASE WHEN v_type = 'in' OR v_last.id IS NULL THEN (v_now AT TIME ZONE v_tz)::date ELSE v_last.work_date END;
  INSERT INTO attendance_events (company_id, employee_id, station_id, location_id, type, occurred_at, work_date, status, source,
                                 idempotency_key, device_id, reason)
  VALUES (v_emp.company_id, v_emp.id, p_station, v_loc.id, v_type, v_now, v_work_date, v_status,
          CASE p_mode WHEN 'dynamic' THEN 'qr_dynamic' WHEN 'static' THEN 'qr_static' ELSE 'link' END, p_idempotency, v_device_id,
          CASE WHEN v_status = 'rejected' THEN v_geo_msg ELSE NULLIF(array_to_string(v_reasons, ' '), '') END)
  RETURNING id INTO v_event;
  INSERT INTO attendance_validations (company_id, event_id, qr_mode, token_valid, latitude, longitude, accuracy_m, distance_m,
                                      geofence_result, device_result, details)
  VALUES (v_emp.company_id, v_event, CASE WHEN p_mode IN ('dynamic', 'static') THEN p_mode::qr_mode END, true,
          round(p_lat::numeric, 5), round(p_lng::numeric, 5), round(p_accuracy::numeric, 1), round(v_center::numeric, 1), v_geo, v_device,
          jsonb_build_object('maxAccuracyM', v_loc.max_accuracy_m, 'radiusM', v_loc.radius_m, 'devicePolicy', v_settings ->> 'devicePolicy',
                             'mode', p_mode, 'requireGps', p_require_gps));
  IF v_device_id IS NOT NULL THEN UPDATE trusted_devices SET last_used_at = v_now WHERE id = v_device_id; END IF;
  IF v_status <> 'rejected' THEN PERFORM ps_recompute_daily(v_emp.id, v_work_date); END IF;
  SELECT worked_minutes INTO v_worked FROM attendance_daily WHERE employee_id = v_emp.id AND work_date = v_work_date;
  v_msg := CASE
    WHEN v_status = 'accepted' THEN CASE v_type WHEN 'in' THEN 'Entrada registada.' WHEN 'out' THEN 'Saída registada.'
                                          WHEN 'break_start' THEN 'Início de intervalo registado.' ELSE 'Fim de intervalo registado.' END
    WHEN v_status = 'review' THEN 'Marcação registada e enviada para revisão.'
    ELSE v_geo_msg END;
  RETURN jsonb_build_object('eventId', v_event, 'type', v_type, 'status', v_status, 'occurredAt', v_now,
                            'geofence', v_geo, 'device', v_device, 'message', v_msg, 'duplicate', false,
                            'distanceM', round(v_center::numeric, 1), 'location', v_loc.name, 'workedMinutes', COALESCE(v_worked, 0));
END $$;

-- 5. Marcação por QR (dinâmico ou fixo). O QR fixo respeita o horário de validade definido.
CREATE OR REPLACE FUNCTION ps_clock(
  p_token text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_idempotency text, p_device_key text DEFAULT NULL, p_requested text DEFAULT NULL,
  p_request_review boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_hash text := encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex');
  v_ch qr_challenges; v_st attendance_stations; v_mode text; v_local time;
BEGIN
  PERFORM ps_require(true);
  IF p_idempotency IS NULL OR length(p_idempotency) < 8 THEN RAISE EXCEPTION 'Pedido inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_ch FROM qr_challenges WHERE token_hash = v_hash;
  IF v_ch.id IS NOT NULL THEN
    IF now() > v_ch.expires_at + interval '10 seconds' THEN
      RAISE EXCEPTION 'O QR Code expirou. Leia novamente o código apresentado na estação.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_st FROM attendance_stations WHERE id = v_ch.station_id;
    v_mode := 'dynamic';
  ELSE
    SELECT * INTO v_st FROM attendance_stations WHERE qr_mode = 'static' AND static_token_hash = v_hash;
    v_mode := 'static';
  END IF;
  IF v_st.id IS NULL THEN RAISE EXCEPTION 'QR Code não reconhecido pelo Horbit.' USING ERRCODE = '22023'; END IF;
  IF NOT v_st.active THEN RAISE EXCEPTION 'Estação de marcação inactiva.' USING ERRCODE = '22023'; END IF;
  IF v_mode = 'static' AND v_st.window_start IS NOT NULL THEN
    v_local := (now() AT TIME ZONE ps_company_tz(v_st.company_id))::time;
    IF v_local < v_st.window_start OR v_local > v_st.window_end THEN
      RAISE EXCEPTION 'Este QR Code só aceita marcações entre as % e as %.',
        to_char(v_st.window_start, 'HH24:MI'), to_char(v_st.window_end, 'HH24:MI') USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN ps_clock_apply(v_st.id, v_st.location_id, v_mode, true, p_lat, p_lng, p_accuracy, p_idempotency, p_device_key,
                        p_requested, p_request_review, p_note);
END $$;

-- 6. Marcação por link (só dentro do dia e das horas definidas).
CREATE OR REPLACE FUNCTION ps_clock_link(
  p_link uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_idempotency text, p_device_key text DEFAULT NULL, p_requested text DEFAULT NULL,
  p_request_review boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_l clock_links; v_local timestamp;
BEGIN
  PERFORM ps_require(true);
  IF p_idempotency IS NULL OR length(p_idempotency) < 8 THEN RAISE EXCEPTION 'Pedido inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_l FROM clock_links WHERE id = p_link AND active;
  IF v_l.id IS NULL THEN RAISE EXCEPTION 'Este link de marcação não existe ou foi removido.' USING ERRCODE = '22023'; END IF;
  v_local := now() AT TIME ZONE ps_company_tz(v_l.company_id);
  IF v_local::date <> v_l.work_date OR v_local::time < v_l.start_time OR v_local::time > v_l.end_time THEN
    RAISE EXCEPTION 'A marcação por link só está disponível no dia % entre as % e as %.',
      to_char(v_l.work_date, 'DD/MM'), to_char(v_l.start_time, 'HH24:MI'), to_char(v_l.end_time, 'HH24:MI') USING ERRCODE = '22023';
  END IF;
  RETURN ps_clock_apply(NULL, v_l.location_id, 'link', v_l.require_gps, p_lat, p_lng, p_accuracy, p_idempotency, p_device_key,
                        p_requested, p_request_review, p_note);
END $$;

-- Permissões das funções novas.
REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM PUBLIC;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_station_fixed_qr(uuid, boolean)', 'ps_station_set_window(uuid, time, time)',
    'ps_clock_link_save(uuid, uuid, uuid, date, time, time, text, boolean)', 'ps_clock_link_delete(uuid)', 'ps_my_clock_links(uuid)',
    'ps_clock(text, double precision, double precision, double precision, text, text, text, boolean, text)',
    'ps_clock_link(uuid, double precision, double precision, double precision, text, text, text, boolean, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM anon;
  END IF;
  REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM authenticated;
END $$;

COMMIT;
