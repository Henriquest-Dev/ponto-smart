-- Horbit, script 4, parte 8: QR dinâmico e QR fixo em simultâneo, link de reserva diário automático e geofence melhorado
-- Pode ser executado de novo sem problema. Requer as partes 1 a 7.
BEGIN;

-- 1. QR dinâmico de volta: a estação mostra sempre o QR dinâmico e o QR fixo impresso continua a funcionar.
--    O modo deixa de ser "um ou outro"; todas as estações voltam a dinâmico.
UPDATE attendance_stations SET qr_mode = 'dynamic' WHERE qr_mode <> 'dynamic';

CREATE OR REPLACE FUNCTION ps_station_fixed_qr(p_station uuid, p_new boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'locations.manage'), 'Sem permissão para gerir o QR Code.');
  v_token := v_st.static_token;
  IF v_token IS NULL OR p_new THEN
    v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
    UPDATE attendance_stations SET static_token = v_token, static_token_hash = encode(digest(v_token, 'sha256'), 'hex')
     WHERE id = v_st.id;
    PERFORM ps_audit_log(v_st.company_id, CASE WHEN v_st.static_token IS NULL THEN 'qr.created' ELSE 'qr.regenerated' END,
                         'attendance_station', v_st.id::text, NULL, jsonb_build_object('station', v_st.name));
  END IF;
  RETURN jsonb_build_object('token', v_token, 'station', v_st.name,
    'location', (SELECT name FROM work_locations WHERE id = v_st.location_id),
    'company', (SELECT name FROM companies WHERE id = v_st.company_id),
    'windowStart', to_char(v_st.window_start, 'HH24:MI'), 'windowEnd', to_char(v_st.window_end, 'HH24:MI'));
END $$;

-- Função antiga (Locais e estações): passa a devolver o mesmo QR fixo, sem o trocar.
CREATE OR REPLACE FUNCTION ps_station_static_qr(p_station uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  RETURN ps_station_fixed_qr(p_station, false) ->> 'token';
END $$;

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
    SELECT * INTO v_st FROM attendance_stations WHERE static_token_hash = v_hash LIMIT 1;
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

-- 2. Link de reserva diário: um por estação e por dia, criado sozinho, expira no fim do dia.
--    Só para quando o QR Code falha; o gestor envia-o ou mostra o botão aos colaboradores nesse dia.
ALTER TABLE clock_links ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE clock_links ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES attendance_stations(id) ON DELETE CASCADE;
ALTER TABLE clock_links ADD COLUMN IF NOT EXISTS shown boolean NOT NULL DEFAULT true;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clock_links_kind_chk') THEN
    ALTER TABLE clock_links ADD CONSTRAINT clock_links_kind_chk CHECK (kind IN ('manual', 'daily'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS clock_links_daily_uq ON clock_links (station_id, work_date) WHERE kind = 'daily';

CREATE OR REPLACE FUNCTION ps_daily_links(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_local timestamp := now() AT TIME ZONE ps_company_tz(p_company);
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'locations.manage') OR ps_has_perm(p_company, 'attendance.manage'),
                     'Sem permissão para ver os links de marcação.');
  -- Cria (ou acerta o horário de) o link de hoje de cada estação activa. Segue o horário do QR Code, se houver.
  INSERT INTO clock_links (company_id, location_id, station_id, kind, work_date, start_time, end_time, require_gps, shown)
  SELECT s.company_id, s.location_id, s.id, 'daily', v_local::date,
         COALESCE(s.window_start, time '00:00'), COALESCE(s.window_end, time '23:59:59'), true, false
    FROM attendance_stations s
   WHERE s.company_id = p_company AND s.active
  ON CONFLICT (station_id, work_date) WHERE kind = 'daily'
  DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, location_id = EXCLUDED.location_id;
  DELETE FROM clock_links WHERE company_id = p_company AND kind = 'daily' AND work_date < v_local::date - 90;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', l.id, 'stationId', s.id, 'station', s.name, 'location', w.name, 'date', l.work_date,
            'start', to_char(l.start_time, 'HH24:MI'), 'end', to_char(l.end_time, 'HH24:MI'),
            'shown', l.shown, 'open', v_local::time BETWEEN l.start_time AND l.end_time) ORDER BY s.name), '[]')
            FROM clock_links l JOIN attendance_stations s ON s.id = l.station_id JOIN work_locations w ON w.id = l.location_id
           WHERE l.company_id = p_company AND l.kind = 'daily' AND l.work_date = v_local::date AND s.active);
END $$;

CREATE OR REPLACE FUNCTION ps_daily_link_show(p_link uuid, p_shown boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_l clock_links;
BEGIN
  SELECT * INTO v_l FROM clock_links WHERE id = p_link AND kind = 'daily';
  PERFORM ps_require(v_l.id IS NOT NULL AND (ps_has_perm(v_l.company_id, 'locations.manage') OR ps_has_perm(v_l.company_id, 'attendance.manage')),
                     'Sem permissão para alterar o link de marcação.');
  UPDATE clock_links SET shown = COALESCE(p_shown, false) WHERE id = v_l.id;
  PERFORM ps_audit_log(v_l.company_id, CASE WHEN p_shown THEN 'clock_link.shown' ELSE 'clock_link.hidden' END, 'clock_link', v_l.id::text, NULL,
                       jsonb_build_object('date', v_l.work_date, 'start', to_char(v_l.start_time, 'HH24:MI'), 'end', to_char(v_l.end_time, 'HH24:MI')));
END $$;

-- Links de hoje para o colaborador: os de dias especiais e o link de reserva quando o gestor o mostra.
CREATE OR REPLACE FUNCTION ps_my_clock_links(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_local timestamp := now() AT TIME ZONE ps_company_tz(p_company);
BEGIN
  PERFORM ps_require(ps_my_employee(p_company) IS NOT NULL, 'Não tem ficha de colaborador nesta empresa.');
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', l.id, 'date', l.work_date, 'start', to_char(l.start_time, 'HH24:MI'), 'end', to_char(l.end_time, 'HH24:MI'),
            'note', l.note, 'location', w.name, 'requireGps', l.require_gps, 'kind', l.kind,
            'open', v_local::time BETWEEN l.start_time AND l.end_time) ORDER BY l.start_time), '[]')
            FROM clock_links l JOIN work_locations w ON w.id = l.location_id
           WHERE l.company_id = p_company AND l.active AND l.shown AND l.work_date = v_local::date AND v_local::time <= l.end_time);
END $$;

-- 3. Geofence: margem de tolerância por local e decisão mais justa quando o GPS é fraco mas a pessoa está claramente dentro.
ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS tolerance_m integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_locations_tolerance_chk') THEN
    ALTER TABLE work_locations ADD CONSTRAINT work_locations_tolerance_chk CHECK (tolerance_m BETWEEN 0 AND 200);
  END IF;
END $$;
GRANT SELECT (tolerance_m) ON work_locations TO authenticated;
GRANT INSERT (tolerance_m), UPDATE (tolerance_m) ON work_locations TO authenticated;

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
  v_event uuid; v_now timestamptz := now(); v_msg text; v_window int; v_worked int; v_tol double precision; v_eff double precision;
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
  -- Margem de tolerância do local: conta como dentro até X metros além do limite.
  v_tol := COALESCE(v_loc.tolerance_m, 0);
  v_eff := v_outside - v_tol;
  IF v_outside IS NULL OR p_accuracy IS NULL THEN
    v_geo := 'unavailable'; v_geo_msg := 'Localização indisponível. A marcação fica em revisão.';
  ELSIF v_loc.geom IS NULL AND v_eff + p_accuracy <= 0 THEN
    -- Mesmo com o erro do GPS, a pessoa está claramente dentro do círculo.
    v_geo := 'inside'; v_geo_msg := 'Dentro do perímetro autorizado.';
  ELSIF p_accuracy > v_loc.max_accuracy_m THEN
    v_geo := 'inconclusive'; v_geo_msg := format('Precisão GPS insuficiente (±%s m). Tente novamente ao ar livre ou peça revisão.', round(p_accuracy));
  ELSIF v_eff <= 0 THEN
    v_geo := 'inside'; v_geo_msg := 'Dentro do perímetro autorizado.';
  ELSIF v_eff <= p_accuracy THEN
    v_geo := 'inconclusive'; v_geo_msg := format('Muito perto do limite do local (a cerca de %s m). Tente novamente ou peça revisão.', round(v_eff));
  ELSE
    v_geo := 'outside'; v_geo_msg := format('Fora do perímetro autorizado: está a cerca de %s m do local.', round(v_eff));
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
  IF p_mode = 'link' THEN v_reasons := v_reasons || 'Marcação por link (QR Code com problemas ou dia especial).'::text; END IF;
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
          jsonb_build_object('maxAccuracyM', v_loc.max_accuracy_m, 'radiusM', v_loc.radius_m, 'toleranceM', v_tol, 'devicePolicy', v_settings ->> 'devicePolicy',
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
                            'distanceM', round(v_center::numeric, 1), 'location', v_loc.name, 'workedMinutes', COALESCE(v_worked, 0),
                            'outsideM', round(GREATEST(v_eff, 0)::numeric), 'accuracyM', round(p_accuracy::numeric), 'radiusM', v_loc.radius_m,
                            'maxAccuracyM', v_loc.max_accuracy_m);
END $$;

-- 4. Assistente: sabe que há QR dinâmico, QR fixo e link de reserva do dia.
CREATE OR REPLACE FUNCTION ps_ai_context(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date; v_month date; v jsonb; v_tz text := ps_company_tz(p_company);
BEGIN
  PERFORM ps_require(ps_has_perm(p_company, 'ai.use'), 'Sem acesso ao assistente.');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_month := date_trunc('month', v_today)::date;
  SELECT jsonb_build_object(
    'empresa', (SELECT name FROM companies WHERE id = p_company),
    'hoje', v_today,
    'horaLocal', to_char(now() AT TIME ZONE v_tz, 'HH24:MI'),
    'papel', ps_role(p_company),
    'resumo', ps_company_dashboard(p_company, 30) - 'todayRows' - 'series',
    'hojeDetalhe', (SELECT jsonb_agg(jsonb_build_object('nome', x ->> 'name', 'estado', x ->> 'status', 'atrasoMin', x ->> 'lateMinutes'))
                    FROM jsonb_array_elements(ps_company_dashboard(p_company, 7) -> 'todayRows') x),
    'equipaEsteMes', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', e.id, 'nome', e.full_name, 'numero', e.employee_code, 'funcao', e.job_title, 'departamento', d.name,
          'diasTrabalhados', COALESCE(m.worked_days, 0), 'horasTrabalhadas', round(COALESCE(m.worked, 0) / 60.0, 1),
          'horasExtra', round(COALESCE(m.overtime, 0) / 60.0, 1), 'diasComAtraso', COALESCE(m.late_days, 0),
          'minutosAtraso', COALESCE(m.late_min, 0), 'faltasJustificadas', COALESCE(m.justified, 0),
          'faltasInjustificadas', COALESCE(m.unjustified, 0), 'porRegularizar', COALESCE(m.pending, 0)) ORDER BY e.full_name), '[]')
        FROM employees e LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN (SELECT employee_id,
                          count(*) FILTER (WHERE worked_minutes > 0) AS worked_days, sum(worked_minutes) AS worked,
                          sum(overtime_minutes) AS overtime, count(*) FILTER (WHERE status = 'late') AS late_days,
                          sum(late_minutes) AS late_min, count(*) FILTER (WHERE status = 'justified') AS justified,
                          count(*) FILTER (WHERE status = 'unjustified') AS unjustified,
                          count(*) FILTER (WHERE status IN ('absent_pending', 'incomplete', 'review')) AS pending
                     FROM attendance_daily WHERE company_id = p_company AND work_date >= v_month GROUP BY employee_id) m
          ON m.employee_id = e.id
       WHERE e.company_id = p_company AND e.status = 'active'),
    'atrasos30dias', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', e.full_name, 'dias', t.n, 'minutos', t.m) ORDER BY t.m DESC), '[]')
                      FROM (SELECT employee_id, count(*) n, sum(late_minutes) m FROM attendance_daily
                             WHERE company_id = p_company AND status = 'late' AND work_date > v_today - 30 GROUP BY employee_id) t
                      JOIN employees e ON e.id = t.employee_id),
    'justificacoesPendentes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'nome', e.full_name, 'de', a.start_date, 'ate', a.end_date,
                                 'tipo', a.type, 'motivo', a.reason,
                                 'anexos', (SELECT count(*) FROM absence_documents dd WHERE dd.request_id = a.id))), '[]')
                               FROM absence_requests a JOIN employees e ON e.id = a.employee_id
                               WHERE a.company_id = p_company AND a.status = 'pending'),
    'marcacoesEmRevisao', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ev.id, 'nome', e.full_name, 'tipo', ev.type,
                             'quando', to_char(ev.occurred_at AT TIME ZONE v_tz, 'DD/MM HH24:MI'), 'motivo', ev.reason)), '[]')
                           FROM attendance_events ev JOIN employees e ON e.id = ev.employee_id
                          WHERE ev.company_id = p_company AND ev.status = 'review'),
    'qrCode', (SELECT COALESCE(jsonb_agg(jsonb_build_object('estacao', s.name, 'qrDinamico', 'no ecrã da estação, muda a cada ' || s.rotation_seconds || ' s',
                 'qrFixoImpresso', s.static_token_hash IS NOT NULL,
                 'linkReservaHoje', COALESCE((SELECT CASE WHEN l.shown THEN 'activo e visível aos colaboradores' ELSE 'criado, não visível' END
                    FROM clock_links l WHERE l.station_id = s.id AND l.kind = 'daily' AND l.work_date = v_today), 'ainda não criado'),
                 'horario', CASE WHEN s.window_start IS NULL THEN 'qualquer hora'
                                 ELSE to_char(s.window_start, 'HH24:MI') || '–' || to_char(s.window_end, 'HH24:MI') END)), '[]')
               FROM attendance_stations s WHERE s.company_id = p_company AND s.active),
    'marcacoesPorLink', (SELECT COALESCE(jsonb_agg(jsonb_build_object('dia', l.work_date, 'das', to_char(l.start_time, 'HH24:MI'),
                           'as', to_char(l.end_time, 'HH24:MI'), 'motivo', l.note) ORDER BY l.work_date), '[]')
                         FROM clock_links l WHERE l.company_id = p_company AND l.kind = 'manual' AND l.work_date >= v_today),
    'auditoriaRecente', CASE WHEN ps_has_perm(p_company, 'audit.view') THEN
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('quando', to_char(a.created_at AT TIME ZONE v_tz, 'DD/MM HH24:MI'),
                  'quem', COALESCE(u.name, 'Sistema'), 'accao', a.action,
                  'sobre', COALESCE(a.after ->> 'full_name', a.after ->> 'name', a.before ->> 'full_name', a.before ->> 'name'))), '[]')
           FROM (SELECT * FROM audit_log_clean WHERE company_id = p_company ORDER BY created_at DESC LIMIT 25) a
           LEFT JOIN users u ON u.id = a.actor_id)
      ELSE NULL END,
    'salarios', CASE WHEN ps_has_perm(p_company, 'payroll.view') THEN
        (SELECT jsonb_agg(jsonb_build_object('periodo', p.year || '-' || lpad(p.month::text, 2, '0'), 'estado', p.status,
                 'execucao', (SELECT jsonb_build_object('versao', r.version, 'estado', r.status, 'totais', r.totals, 'avisos', r.warnings)
                                FROM payroll_runs r WHERE r.period_id = p.id ORDER BY r.version DESC LIMIT 1)) ORDER BY p.year DESC, p.month DESC)
           FROM (SELECT * FROM payroll_periods WHERE company_id = p_company ORDER BY year DESC, month DESC LIMIT 3) p)
      ELSE NULL END
  ) INTO v;
  RETURN v;
END $$;

-- 5. Permissões.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_station_fixed_qr(uuid, boolean)', 'ps_station_static_qr(uuid)', 'ps_daily_links(uuid)',
    'ps_daily_link_show(uuid, boolean)', 'ps_my_clock_links(uuid)',
    'ps_clock(text, double precision, double precision, double precision, text, text, text, boolean, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM anon;
  END IF;
  REVOKE ALL ON FUNCTION ps_clock_apply(uuid, uuid, text, boolean, double precision, double precision, double precision, text, text, text, boolean, text) FROM authenticated;
END $$;

COMMIT;
