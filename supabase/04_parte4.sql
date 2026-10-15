-- Horbit, script 4, parte 4 de 5: QR, marcação de ponto e justificações
BEGIN;
CREATE OR REPLACE FUNCTION ps_station_qr(p_station uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text; v_ttl int; v_exp timestamptz;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'stations.display'), 'Sem permissão para abrir esta estação.');
  IF NOT v_st.active THEN RAISE EXCEPTION 'Estação inactiva.' USING ERRCODE = '22023'; END IF;
  v_ttl := GREATEST(10, LEAST(COALESCE(v_st.rotation_seconds, 30), 300));
  v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_exp := now() + make_interval(secs => v_ttl);
  INSERT INTO qr_challenges (company_id, station_id, token_hash, expires_at)
  VALUES (v_st.company_id, v_st.id, encode(digest(v_token, 'sha256'), 'hex'), v_exp);
  UPDATE attendance_stations SET last_seen_at = now() WHERE id = v_st.id;
  DELETE FROM qr_challenges WHERE station_id = v_st.id AND expires_at < now() - interval '1 hour';
  RETURN jsonb_build_object('token', v_token, 'expiresAt', v_exp, 'ttl', v_ttl, 'station', v_st.name,
                            'location', (SELECT name FROM work_locations WHERE id = v_st.location_id));
END $$;
CREATE OR REPLACE FUNCTION ps_station_static_qr(p_station uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_st attendance_stations; v_token text;
BEGIN
  SELECT * INTO v_st FROM attendance_stations WHERE id = p_station;
  PERFORM ps_require(v_st.id IS NOT NULL AND ps_has_perm(v_st.company_id, 'locations.manage'));
  v_token := 'ps1.' || translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  UPDATE attendance_stations SET qr_mode = 'static', static_token_hash = encode(digest(v_token, 'sha256'), 'hex') WHERE id = v_st.id;
  RETURN v_token;
END $$;
CREATE OR REPLACE FUNCTION ps_clock(
  p_token text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_idempotency text, p_device_key text DEFAULT NULL, p_requested text DEFAULT NULL,
  p_request_review boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_hash text := encode(digest(COALESCE(p_token, ''), 'sha256'), 'hex');
  v_ch qr_challenges; v_st attendance_stations; v_loc work_locations; v_mode qr_mode;
  v_emp employees; v_company companies; v_settings jsonb; v_tz text;
  v_outside double precision; v_center double precision; v_geo geofence_result; v_geo_msg text;
  v_device device_result := 'not_required'; v_device_id uuid; v_status attendance_event_status := 'accepted';
  v_reasons text[] := '{}'; v_prior record; v_last record; v_type attendance_event_type; v_work_date date;
  v_event uuid; v_now timestamptz := now(); v_msg text; v_window int;
BEGIN
  PERFORM ps_require(true);
  IF p_idempotency IS NULL OR length(p_idempotency) < 8 THEN RAISE EXCEPTION 'Pedido inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_ch FROM qr_challenges WHERE token_hash = v_hash;
  IF v_ch.id IS NOT NULL THEN
    IF v_now > v_ch.expires_at + interval '10 seconds' THEN
      RAISE EXCEPTION 'O QR Code expirou. Leia novamente o código apresentado na estação.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_st FROM attendance_stations WHERE id = v_ch.station_id;
    v_mode := 'dynamic';
  ELSE
    SELECT * INTO v_st FROM attendance_stations WHERE qr_mode = 'static' AND static_token_hash = v_hash;
    v_mode := 'static';
  END IF;
  IF v_st.id IS NULL THEN RAISE EXCEPTION 'QR Code não reconhecido pelo Horbit.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_emp FROM employees WHERE user_id = auth.uid() AND company_id = v_st.company_id AND status = 'active';
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Este QR Code pertence a outra empresa.' USING ERRCODE = '42501'; END IF;
  PERFORM ps_require(ps_has_perm(v_st.company_id, 'self.clock'), 'Sem permissão para marcar ponto.');
  SELECT * INTO v_loc FROM work_locations WHERE id = v_st.location_id;
  IF NOT v_st.active OR NOT v_loc.active THEN RAISE EXCEPTION 'Estação de marcação inactiva.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_company FROM companies WHERE id = v_st.company_id;
  v_settings := v_company.settings; v_tz := v_company.timezone;
  SELECT ev.id, ev.type, ev.status, ev.occurred_at, va.geofence_result, va.device_result INTO v_prior
    FROM attendance_events ev LEFT JOIN attendance_validations va ON va.event_id = ev.id
   WHERE ev.employee_id = v_emp.id AND ev.idempotency_key = p_idempotency LIMIT 1;
  IF v_prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('eventId', v_prior.id, 'type', v_prior.type, 'status', v_prior.status, 'occurredAt', v_prior.occurred_at,
      'geofence', COALESCE(v_prior.geofence_result::text, 'unavailable'), 'device', COALESCE(v_prior.device_result::text, 'not_required'),
      'message', 'Pedido já processado.', 'duplicate', true);
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
  IF v_geo = 'outside' THEN
    IF p_request_review THEN v_status := 'review'; v_reasons := v_reasons || 'Fora do perímetro — revisão pedida pelo colaborador.';
    ELSE v_status := 'rejected'; END IF;
  ELSIF v_geo <> 'inside' THEN
    v_status := 'review'; v_reasons := v_reasons || v_geo_msg;
  END IF;
  IF v_settings ->> 'devicePolicy' = 'require' AND v_device <> 'trusted' AND v_status = 'accepted' THEN
    v_status := 'review'; v_reasons := v_reasons || 'Dispositivo não reconhecido como de confiança.'::text;
  END IF;
  IF NULLIF(trim(p_note), '') IS NOT NULL THEN v_reasons := v_reasons || ('Nota do colaborador: ' || left(p_note, 300)); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_emp.id::text));
  SELECT id, type, occurred_at, work_date, status INTO v_last FROM attendance_events
   WHERE employee_id = v_emp.id AND status <> 'rejected' AND occurred_at >= v_now - interval '20 hours'
   ORDER BY occurred_at DESC LIMIT 1;
  v_window := COALESCE((v_settings ->> 'duplicateWindowMinutes')::int, 2);
  IF v_last.id IS NOT NULL AND v_status <> 'rejected' AND v_now - v_last.occurred_at < make_interval(mins => v_window) THEN
    RETURN jsonb_build_object('eventId', v_last.id, 'type', v_last.type, 'status', v_last.status, 'occurredAt', v_last.occurred_at,
      'geofence', v_geo, 'device', v_device, 'message', 'Marcação já registada há instantes. Não foi criada nova marcação.', 'duplicate', true);
  END IF;
  v_type := CASE
    WHEN v_last.id IS NULL OR v_last.type = 'out' THEN 'in'
    WHEN v_last.type = 'break_start' THEN 'break_end'
    WHEN p_requested = 'break_start' THEN 'break_start'
    ELSE 'out' END;
  v_work_date := CASE WHEN v_type = 'in' OR v_last.id IS NULL THEN (v_now AT TIME ZONE v_tz)::date ELSE v_last.work_date END;
  INSERT INTO attendance_events (company_id, employee_id, station_id, location_id, type, occurred_at, work_date, status, source,
                                 idempotency_key, device_id, reason)
  VALUES (v_emp.company_id, v_emp.id, v_st.id, v_loc.id, v_type, v_now, v_work_date, v_status,
          CASE WHEN v_mode = 'dynamic' THEN 'qr_dynamic' ELSE 'qr_static' END, p_idempotency, v_device_id,
          CASE WHEN v_status = 'rejected' THEN v_geo_msg ELSE NULLIF(array_to_string(v_reasons, ' '), '') END)
  RETURNING id INTO v_event;
  INSERT INTO attendance_validations (company_id, event_id, qr_mode, token_valid, latitude, longitude, accuracy_m, distance_m,
                                      geofence_result, device_result, details)
  VALUES (v_emp.company_id, v_event, v_mode, true, round(p_lat::numeric, 5), round(p_lng::numeric, 5),
          round(p_accuracy::numeric, 1), round(v_center::numeric, 1), v_geo, v_device,
          jsonb_build_object('maxAccuracyM', v_loc.max_accuracy_m, 'radiusM', v_loc.radius_m, 'devicePolicy', v_settings ->> 'devicePolicy'));
  IF v_device_id IS NOT NULL THEN UPDATE trusted_devices SET last_used_at = v_now WHERE id = v_device_id; END IF;
  IF v_status <> 'rejected' THEN PERFORM ps_recompute_daily(v_emp.id, v_work_date); END IF;
  v_msg := CASE
    WHEN v_status = 'accepted' THEN CASE v_type WHEN 'in' THEN 'Entrada registada.' WHEN 'out' THEN 'Saída registada.'
                                          WHEN 'break_start' THEN 'Início de intervalo registado.' ELSE 'Fim de intervalo registado.' END
    WHEN v_status = 'review' THEN 'Marcação registada e enviada para revisão.'
    ELSE v_geo_msg END;
  RETURN jsonb_build_object('eventId', v_event, 'type', v_type, 'status', v_status, 'occurredAt', v_now,
                            'geofence', v_geo, 'device', v_device, 'message', v_msg, 'duplicate', false,
                            'distanceM', round(v_center::numeric, 1), 'location', v_loc.name);
END $$;
CREATE OR REPLACE FUNCTION ps_my_status(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp uuid := ps_my_employee(p_company); v_last record;
BEGIN
  PERFORM ps_require(v_emp IS NOT NULL, 'Não tem ficha de colaborador nesta empresa.');
  SELECT type, occurred_at, status, work_date INTO v_last FROM attendance_events
   WHERE employee_id = v_emp AND status <> 'rejected' AND occurred_at >= now() - interval '20 hours'
   ORDER BY occurred_at DESC LIMIT 1;
  RETURN jsonb_build_object('employeeId', v_emp, 'lastType', v_last.type, 'lastAt', v_last.occurred_at, 'lastStatus', v_last.status,
                            'workDate', v_last.work_date);
END $$;
CREATE OR REPLACE FUNCTION ps_register_device(p_company uuid, p_device_key text, p_label text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_emp uuid := ps_my_employee(p_company); v_id uuid; v_hash text := encode(digest(p_device_key, 'sha256'), 'hex');
BEGIN
  PERFORM ps_require(v_emp IS NOT NULL);
  IF length(COALESCE(p_device_key, '')) < 16 THEN RAISE EXCEPTION 'Chave de dispositivo inválida.' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM trusted_devices WHERE employee_id = v_emp AND credential_id = v_hash AND revoked_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF (SELECT count(*) FROM trusted_devices WHERE employee_id = v_emp AND revoked_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'Limite de 3 dispositivos. Remova um no perfil.' USING ERRCODE = '54000';
  END IF;
  UPDATE trusted_devices SET revoked_at = NULL, label = left(COALESCE(p_label, label), 60)
   WHERE employee_id = v_emp AND credential_id = v_hash RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO trusted_devices (company_id, employee_id, credential_id, label) VALUES (p_company, v_emp, v_hash, left(COALESCE(p_label, 'Telemóvel'), 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION ps_revoke_device(p_device uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_d trusted_devices;
BEGIN
  SELECT * INTO v_d FROM trusted_devices WHERE id = p_device;
  PERFORM ps_require(v_d.id IS NOT NULL AND (ps_is_self_employee(v_d.employee_id) OR ps_has_perm(v_d.company_id, 'attendance.manage')));
  UPDATE trusted_devices SET revoked_at = COALESCE(revoked_at, now()) WHERE id = v_d.id;
END $$;
CREATE OR REPLACE FUNCTION ps_review_event(p_event uuid, p_decision text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ev attendance_events;
BEGIN
  SELECT * INTO v_ev FROM attendance_events WHERE id = p_event;
  PERFORM ps_require(v_ev.id IS NOT NULL AND (ps_can_employee(v_ev.company_id, v_ev.employee_id, 'attendance.manage')
                     OR ps_can_employee(v_ev.company_id, v_ev.employee_id, 'absence.decide.team')));
  IF EXISTS (SELECT 1 FROM employees WHERE id = v_ev.employee_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Não pode rever as suas próprias marcações.' USING ERRCODE = '42501';
  END IF;
  IF v_ev.status <> 'review' THEN RAISE EXCEPTION 'Esta marcação já foi revista.' USING ERRCODE = '22023'; END IF;
  IF p_decision NOT IN ('accepted', 'rejected') THEN RAISE EXCEPTION 'Decisão inválida.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o fundamento da decisão.' USING ERRCODE = '22023'; END IF;
  UPDATE attendance_events SET status = p_decision::attendance_event_status, reviewed_by = auth.uid(), reviewed_at = now(),
         reason = concat_ws(' ', reason, 'Revisão: ' || p_reason)
   WHERE id = v_ev.id;
  PERFORM ps_recompute_daily(v_ev.employee_id, v_ev.work_date);
  PERFORM ps_audit_log(v_ev.company_id, 'attendance.reviewed', 'attendance_event', v_ev.id::text,
                       jsonb_build_object('status', v_ev.status), jsonb_build_object('status', p_decision, 'reason', p_reason));
END $$;
CREATE OR REPLACE FUNCTION ps_classify_day(p_daily uuid, p_status text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row attendance_daily;
BEGIN
  SELECT * INTO v_row FROM attendance_daily WHERE id = p_daily;
  PERFORM ps_require(v_row.id IS NOT NULL AND ps_can_employee(v_row.company_id, v_row.employee_id, 'attendance.manage'));
  IF v_row.locked THEN RAISE EXCEPTION 'Período fechado. Reabra a assiduidade para corrigir.' USING ERRCODE = '22023'; END IF;
  IF p_status NOT IN ('unjustified', 'justified', 'on_time', 'present') THEN RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o motivo da correcção.' USING ERRCODE = '22023'; END IF;
  UPDATE attendance_daily SET status = p_status::daily_status, updated_at = now() WHERE id = v_row.id;
  INSERT INTO attendance_adjustments (company_id, employee_id, work_date, author_id, reason, previous, next)
  VALUES (v_row.company_id, v_row.employee_id, v_row.work_date, auth.uid(), p_reason,
          jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status));
  PERFORM ps_audit_log(v_row.company_id, 'attendance.adjusted', 'attendance_daily', v_row.id::text,
                       jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status, 'reason', p_reason));
END $$;
CREATE OR REPLACE FUNCTION ps_submit_absence(p_company uuid, p_start date, p_end date, p_type text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_manager uuid; v_with_sup boolean; v_id uuid;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = ps_my_employee(p_company);
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(p_company, 'self.absence'), 'Sem ficha de colaborador nesta empresa.');
  IF p_end < p_start THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE = '22023'; END IF;
  IF p_type NOT IN ('doenca', 'consulta', 'falecimento', 'casamento', 'parentalidade', 'formacao', 'servico', 'outro') THEN
    RAISE EXCEPTION 'Tipo de justificação inválido.' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Descreva o motivo (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  SELECT d.manager_user_id INTO v_manager FROM departments d WHERE d.id = v_emp.department_id;
  v_with_sup := (SELECT settings ->> 'absenceFlow' FROM companies WHERE id = p_company) = 'supervisor_then_hr'
                AND v_manager IS NOT NULL AND v_manager <> auth.uid();
  INSERT INTO absence_requests (company_id, employee_id, start_date, end_date, type, reason, created_by)
  VALUES (p_company, v_emp.id, p_start, p_end, p_type, left(trim(p_reason), 2000), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO approval_steps (company_id, request_id, step_order, approver_role)
  SELECT p_company, v_id, o, r FROM unnest(CASE WHEN v_with_sup THEN ARRAY['supervisor', 'hr'] ELSE ARRAY['hr'] END) WITH ORDINALITY AS t(r, o);
  PERFORM ps_audit_log(p_company, 'absence.created', 'absence_request', v_id::text, NULL,
                       jsonb_build_object('startDate', p_start, 'endDate', p_end, 'type', p_type));
  IF v_with_sup THEN
    PERFORM ps_notify(p_company, ARRAY[v_manager], 'absence', 'Justificação para analisar', v_emp.full_name || ' submeteu uma justificação.', '/empresa/justificacoes/');
  ELSE
    PERFORM ps_notify_roles(p_company, ARRAY['hr', 'owner'], 'absence', 'Justificação para analisar', v_emp.full_name || ' submeteu uma justificação.', '/empresa/justificacoes/');
  END IF;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION ps_attach_absence_document(p_request uuid, p_path text, p_name text, p_mime text, p_size integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req absence_requests; v_id uuid;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  PERFORM ps_require(v_req.id IS NOT NULL AND ps_is_self_employee(v_req.employee_id));
  IF p_path NOT LIKE v_req.company_id::text || '/' || v_req.id::text || '/%' THEN RAISE EXCEPTION 'Caminho inválido.' USING ERRCODE = '22023'; END IF;
  IF p_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') OR p_size > 5242880 THEN
    RAISE EXCEPTION 'Use PDF ou imagem até 5 MB.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM absence_documents WHERE request_id = v_req.id) >= 3 THEN
    RAISE EXCEPTION 'Máximo de 3 anexos por pedido.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO absence_documents (company_id, request_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
  VALUES (v_req.company_id, v_req.id, p_path, left(p_name, 120), p_mime, p_size, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION ps_cancel_absence(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req absence_requests;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  PERFORM ps_require(v_req.id IS NOT NULL AND ps_is_self_employee(v_req.employee_id));
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Só pode cancelar pedidos pendentes.' USING ERRCODE = '22023'; END IF;
  UPDATE absence_requests SET status = 'cancelled', decided_at = now() WHERE id = v_req.id;
  UPDATE approval_steps SET decision = 'skipped', decided_at = now(), reason = 'Cancelado pelo colaborador'
   WHERE request_id = v_req.id AND decision = 'pending';
END $$;
CREATE OR REPLACE FUNCTION ps_decide_absence(p_request uuid, p_decision text, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_req absence_requests; v_emp employees; v_role text; v_step approval_steps; v_last smallint; v_final boolean;
  d date; v_row attendance_daily;
BEGIN
  SELECT * INTO v_req FROM absence_requests WHERE id = p_request;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = v_req.employee_id;
  IF ps_has_perm(v_req.company_id, 'absence.decide') THEN v_role := 'hr';
  ELSIF ps_can_employee(v_req.company_id, v_req.employee_id, 'absence.decide.team') THEN v_role := 'supervisor';
  END IF;
  PERFORM ps_require(v_role IS NOT NULL, 'Sem permissão para decidir este pedido.');
  IF v_emp.user_id = auth.uid() THEN RAISE EXCEPTION 'Não pode decidir o seu próprio pedido.' USING ERRCODE = '42501'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Este pedido já foi decidido.' USING ERRCODE = '22023'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decisão inválida.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Indique o fundamento da decisão.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_step FROM approval_steps WHERE request_id = v_req.id AND decision = 'pending' ORDER BY step_order LIMIT 1;
  IF v_step.id IS NULL THEN RAISE EXCEPTION 'Sem passos pendentes.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'supervisor' AND v_step.approver_role <> 'supervisor' THEN
    RAISE EXCEPTION 'Este pedido aguarda decisão do RH.' USING ERRCODE = '42501';
  END IF;
  SELECT max(step_order) INTO v_last FROM approval_steps WHERE request_id = v_req.id;
  v_final := p_decision = 'rejected' OR v_step.step_order = v_last OR v_role = 'hr';
  UPDATE approval_steps SET decision = p_decision::approval_decision, approver_id = auth.uid(), reason = p_reason, decided_at = now()
   WHERE id = v_step.id;
  IF v_role = 'hr' THEN
    UPDATE approval_steps SET decision = 'skipped', decided_at = now(), reason = 'Decidido pelo RH'
     WHERE request_id = v_req.id AND decision = 'pending' AND id <> v_step.id;
  END IF;
  IF v_final THEN
    UPDATE absence_requests SET status = p_decision::absence_status, decided_at = now(), decision_reason = p_reason WHERE id = v_req.id;
    IF p_decision = 'approved' THEN
      FOR d IN SELECT generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date LOOP
        SELECT * INTO v_row FROM attendance_daily WHERE employee_id = v_req.employee_id AND work_date = d;
        CONTINUE WHEN v_row.id IS NULL OR v_row.locked OR v_row.status NOT IN ('absent_pending', 'unjustified', 'incomplete', 'late');
        UPDATE attendance_daily SET status = 'justified', absence_request_id = v_req.id, updated_at = now() WHERE id = v_row.id;
        INSERT INTO attendance_adjustments (company_id, employee_id, work_date, author_id, reason, previous, next)
        VALUES (v_req.company_id, v_req.employee_id, d, auth.uid(), 'Justificação aprovada: ' || p_reason,
                jsonb_build_object('status', v_row.status), jsonb_build_object('status', 'justified', 'absenceRequestId', v_req.id));
      END LOOP;
    END IF;
    PERFORM ps_notify(v_req.company_id, ARRAY[v_emp.user_id], 'absence',
      CASE WHEN p_decision = 'approved' THEN 'Justificação aprovada' ELSE 'Justificação recusada' END, p_reason, '/app/justificacoes/');
  ELSE
    PERFORM ps_notify_roles(v_req.company_id, ARRAY['hr'], 'absence', 'Justificação validada pelo supervisor',
      v_emp.full_name || ' — aguarda decisão do RH.', '/empresa/justificacoes/');
  END IF;
  PERFORM ps_audit_log(v_req.company_id, 'absence.' || CASE WHEN v_final THEN p_decision ELSE 'step_approved' END,
                       'absence_request', v_req.id::text, NULL, jsonb_build_object('step', v_step.step_order, 'role', v_role, 'reason', p_reason));
  RETURN CASE WHEN v_final THEN p_decision ELSE 'step_approved' END;
END $$;
COMMIT;
