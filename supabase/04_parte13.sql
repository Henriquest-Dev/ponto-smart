-- Horbit, script 4, parte 13: Oficina e Estoque personalizáveis.
-- Campos personalizados (viatura, cada entrada na oficina, material do estoque), lista de trabalhos editável,
-- fotos das viaturas (a primeira fica como foto de perfil), edição campo a campo (planilha do mês) e resumo mensal.
-- Requer a parte 12. Pode ser executado de novo sem problema.
BEGIN;

-- 1. Valores dos campos personalizados e foto de perfil
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('vehicle', 'visit', 'stock')),
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'longtext', 'number', 'date', 'select', 'yesno')),
  options text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_fields_company_idx ON custom_fields (company_id, entity, position);

CREATE TABLE IF NOT EXISTS vehicle_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  thumb_key text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_photos_vehicle_idx ON vehicle_photos (vehicle_id, created_at);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cover_photo uuid REFERENCES vehicle_photos (id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_fields', 'vehicle_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', t); END IF;
  END LOOP;
END $$;

-- Valida o objecto de valores personalizados (chave = id do campo).
CREATE OR REPLACE FUNCTION ps_extra_clean(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN '{}'::jsonb; END IF;
  IF length(p::text) > 20000 THEN RAISE EXCEPTION 'Os campos personalizados têm texto a mais.' USING ERRCODE = '22023'; END IF;
  RETURN p;
END $$;

-- 2. Campos personalizados
CREATE OR REPLACE FUNCTION ps_custom_field_ok(p_company uuid, p_entity text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_entity WHEN 'stock' THEN ps_manager_ok(p_company) WHEN 'vehicle' THEN ps_manager_ok(p_company, 'oficina')
                       WHEN 'visit' THEN ps_manager_ok(p_company, 'oficina') ELSE false END
$$;

CREATE OR REPLACE FUNCTION ps_custom_fields(p_company uuid, p_entity text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_custom_field_ok(p_company, p_entity));
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'entity', f.entity, 'label', f.label, 'kind', f.kind, 'options', to_jsonb(f.options),
                                        'position', f.position) ORDER BY f.position, f.created_at)
      FROM custom_fields f WHERE f.company_id = p_company AND f.entity = p_entity AND f.active), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION ps_custom_field_save(p_company uuid, p_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid := p_id; v_entity text := p ->> 'entity'; v_label text := trim(COALESCE(p ->> 'label', ''));
  v_kind text := COALESCE(NULLIF(p ->> 'kind', ''), 'text'); v_opts text[];
BEGIN
  IF v_id IS NOT NULL THEN SELECT entity INTO v_entity FROM custom_fields WHERE id = v_id AND company_id = p_company; END IF;
  PERFORM ps_require(v_entity IS NOT NULL AND ps_custom_field_ok(p_company, v_entity));
  IF length(v_label) < 1 OR length(v_label) > 60 THEN RAISE EXCEPTION 'Dê um nome ao campo (até 60 letras).' USING ERRCODE = '22023'; END IF;
  IF v_kind NOT IN ('text', 'longtext', 'number', 'date', 'select', 'yesno') THEN RAISE EXCEPTION 'Tipo de campo inválido.' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(array_agg(o ORDER BY n), '{}') INTO v_opts FROM (
    SELECT DISTINCT ON (lower(trim(o))) trim(o) o, n FROM jsonb_array_elements_text(COALESCE(p -> 'options', '[]')) WITH ORDINALITY AS t(o, n)
     WHERE trim(o) <> '' ORDER BY lower(trim(o)), n) s;
  IF v_kind = 'select' AND (cardinality(v_opts) < 1 OR cardinality(v_opts) > 40) THEN
    RAISE EXCEPTION 'Escreva as opções da lista (entre 1 e 40).' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO custom_fields (company_id, entity, label, kind, options, position, created_by)
    VALUES (p_company, v_entity, v_label, v_kind, v_opts,
            COALESCE((SELECT max(position) + 1 FROM custom_fields WHERE company_id = p_company AND entity = v_entity AND active), 0), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE custom_fields SET label = v_label, kind = v_kind, options = v_opts WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

-- Remover um campo esconde-o (os valores já guardados mantêm-se no histórico).
CREATE OR REPLACE FUNCTION ps_custom_field_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f custom_fields;
BEGIN
  SELECT * INTO f FROM custom_fields WHERE id = p_id;
  PERFORM ps_require(f.id IS NOT NULL AND ps_custom_field_ok(f.company_id, f.entity));
  UPDATE custom_fields SET active = false WHERE id = p_id;
END $$;

-- Subir (-1) ou descer (+1) um campo na ordem.
CREATE OR REPLACE FUNCTION ps_custom_field_move(p_id uuid, p_delta integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f custom_fields; v_ids uuid[]; v_i int; v_tmp uuid;
BEGIN
  SELECT * INTO f FROM custom_fields WHERE id = p_id;
  PERFORM ps_require(f.id IS NOT NULL AND ps_custom_field_ok(f.company_id, f.entity));
  SELECT array_agg(id ORDER BY position, created_at) INTO v_ids FROM custom_fields WHERE company_id = f.company_id AND entity = f.entity AND active;
  v_i := array_position(v_ids, p_id);
  IF v_i IS NULL OR v_i + sign(p_delta)::int < 1 OR v_i + sign(p_delta)::int > cardinality(v_ids) THEN RETURN; END IF;
  v_tmp := v_ids[v_i + sign(p_delta)::int];
  v_ids[v_i + sign(p_delta)::int] := p_id;
  v_ids[v_i] := v_tmp;
  UPDATE custom_fields c SET position = t.n - 1 FROM unnest(v_ids) WITH ORDINALITY AS t(id, n) WHERE c.id = t.id;
END $$;

-- Lista de trabalhos da oficina (editável): fica nas definições da empresa.
CREATE OR REPLACE FUNCTION ps_workshop_services_set(p_company uuid, p_services text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v text[];
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company, 'oficina'));
  SELECT COALESCE(array_agg(s ORDER BY n), '{}') INTO v FROM (
    SELECT DISTINCT ON (lower(trim(s))) left(trim(s), 40) s, n FROM unnest(COALESCE(p_services, '{}')) WITH ORDINALITY AS t(s, n)
     WHERE trim(s) <> '' ORDER BY lower(trim(s)), n) x;
  IF cardinality(v) > 60 THEN RAISE EXCEPTION 'No máximo 60 trabalhos.' USING ERRCODE = '22023'; END IF;
  UPDATE companies SET settings = settings || jsonb_build_object('workshopServices', to_jsonb(v)), updated_at = now() WHERE id = p_company;
  RETURN v;
END $$;

-- 3. Estoque com campos personalizados
CREATE OR REPLACE FUNCTION ps_stock_items(p_company uuid, p_archived boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company));
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'category', i.category, 'unit', i.unit, 'quantity', i.quantity,
      'minQuantity', i.min_quantity, 'notes', i.notes, 'active', i.active, 'state', ps_stock_state(i.quantity, i.min_quantity),
      'lastCountedAt', i.last_counted_at, 'updatedAt', i.updated_at, 'extra', i.extra) ORDER BY lower(i.name))
    FROM stock_items i WHERE i.company_id = p_company AND i.active <> p_archived), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION ps_stock_save(p_company uuid, p_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid := p_id; v_name text := trim(COALESCE(p ->> 'name', '')); v_qty numeric;
  v_min numeric := COALESCE(NULLIF(p ->> 'minQuantity', '')::numeric, 0);
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company));
  IF length(v_name) < 2 THEN RAISE EXCEPTION 'Indique o nome do material.' USING ERRCODE = '22023'; END IF;
  IF v_min < 0 THEN RAISE EXCEPTION 'O mínimo não pode ser negativo.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM stock_items WHERE company_id = p_company AND lower(name) = lower(v_name) AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um material com o nome "%".', v_name USING ERRCODE = '23505';
  END IF;
  IF v_id IS NULL THEN
    v_qty := COALESCE(NULLIF(p ->> 'quantity', '')::numeric, 0);
    IF v_qty < 0 THEN RAISE EXCEPTION 'A quantidade não pode ser negativa.' USING ERRCODE = '22023'; END IF;
    INSERT INTO stock_items (company_id, name, category, unit, quantity, min_quantity, notes, extra, created_by)
    VALUES (p_company, v_name, NULLIF(trim(p ->> 'category'), ''), COALESCE(NULLIF(trim(p ->> 'unit'), ''), 'un'), v_qty, v_min,
            NULLIF(trim(p ->> 'notes'), ''), ps_extra_clean(p -> 'extra'), auth.uid())
    RETURNING id INTO v_id;
    IF v_qty > 0 THEN
      INSERT INTO stock_movements (company_id, item_id, kind, delta, balance_after, note, created_by)
      VALUES (p_company, v_id, 'entrada', v_qty, v_qty, 'Quantidade inicial', auth.uid());
    END IF;
    PERFORM ps_audit_log(p_company, 'stock.item_create', 'stock_item', v_id::text, NULL, jsonb_build_object('name', v_name, 'quantity', v_qty));
  ELSE
    UPDATE stock_items SET name = v_name, category = NULLIF(trim(p ->> 'category'), ''),
           unit = COALESCE(NULLIF(trim(p ->> 'unit'), ''), 'un'), min_quantity = v_min, notes = NULLIF(trim(p ->> 'notes'), ''),
           extra = CASE WHEN jsonb_typeof(p -> 'extra') = 'object' THEN ps_extra_clean(p -> 'extra') ELSE extra END, updated_at = now()
     WHERE id = v_id AND company_id = p_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE = 'P0002'; END IF;
    PERFORM ps_audit_log(p_company, 'stock.item_update', 'stock_item', v_id::text, NULL, jsonb_build_object('name', v_name));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_stock_month(p_company uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text := ps_company_tz(p_company); v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company));
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido.' USING ERRCODE = '22023'; END IF;
  v_start := (p_month || '-01')::date::timestamp AT TIME ZONE v_tz;
  v_end := ((p_month || '-01')::date + interval '1 month')::timestamp AT TIME ZONE v_tz;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'unit', i.unit, 'category', i.category, 'minQuantity', i.min_quantity,
      'start', s.final - s.net, 'entradas', s.entradas, 'saidas', s.saidas, 'acertos', s.acertos, 'end', s.final,
      'state', ps_stock_state(s.final, i.min_quantity), 'lastCountedAt', i.last_counted_at, 'extra', i.extra) ORDER BY lower(i.name))
    FROM stock_items i
    CROSS JOIN LATERAL (
      SELECT
        i.quantity - COALESCE((SELECT sum(delta) FROM stock_movements WHERE item_id = i.id AND created_at >= v_end), 0) AS final,
        COALESCE(sum(m.delta), 0) AS net,
        COALESCE(sum(m.delta) FILTER (WHERE m.kind = 'entrada'), 0) AS entradas,
        COALESCE(-sum(m.delta) FILTER (WHERE m.kind = 'saida'), 0) AS saidas,
        COALESCE(sum(m.delta) FILTER (WHERE m.kind = 'contagem'), 0) AS acertos
      FROM stock_movements m WHERE m.item_id = i.id AND m.created_at >= v_start AND m.created_at < v_end) s
    WHERE i.company_id = p_company AND (i.active OR s.net <> 0) AND i.created_at < v_end), '[]'::jsonb);
END $$;

-- 4. Viaturas: campos personalizados, foto de perfil e edição campo a campo
CREATE OR REPLACE FUNCTION ps_vehicle_cover(p_vehicle uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(ph.thumb_key, ph.storage_key) FROM vehicles v JOIN vehicle_photos ph ON ph.id = v.cover_photo WHERE v.id = p_vehicle
$$;

CREATE OR REPLACE FUNCTION ps_vehicle_search(p_company uuid, p_q text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q text := trim(COALESCE(p_q, '')); v_key text := ps_plate_key(p_q);
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company, 'oficina'), 'A função Oficina não está ligada para a sua conta.');
  RETURN COALESCE((
    SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', v.id, 'plate', v.plate, 'name', v.name, 'ownerName', v.owner_name, 'ownerPhone', v.owner_phone,
             'color', v.color, 'createdAt', v.created_at, 'extra', v.extra, 'cover', ps_vehicle_cover(v.id),
             'visits', (SELECT count(*) FROM vehicle_visits WHERE vehicle_id = v.id),
             'lastVisit', (SELECT max(entered_at) FROM vehicle_visits WHERE vehicle_id = v.id),
             'open', EXISTS (SELECT 1 FROM vehicle_visits WHERE vehicle_id = v.id AND status = 'aberta')) x
        FROM vehicles v
       WHERE v.company_id = p_company
         AND (v_q = '' OR (v_key <> '' AND v.plate_key LIKE '%' || v_key || '%')
              OR v.name ILIKE '%' || v_q || '%' OR v.owner_name ILIKE '%' || v_q || '%' OR v.owner_phone ILIKE '%' || v_q || '%'
              OR v.extra::text ILIKE '%' || v_q || '%')
       ORDER BY (v_key <> '' AND v.plate_key LIKE v_key || '%') DESC,
                COALESCE((SELECT max(entered_at) FROM vehicle_visits WHERE vehicle_id = v.id), v.created_at) DESC
       LIMIT 60) s), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_register(p_company uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plate text := upper(trim(COALESCE(p ->> 'plate', ''))); v_key text; v_id uuid; v_visit uuid;
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company, 'oficina'), 'A função Oficina não está ligada para a sua conta.');
  v_key := ps_plate_key(v_plate);
  IF length(v_key) < 3 THEN RAISE EXCEPTION 'Indique a matrícula.' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM vehicles WHERE company_id = p_company AND plate_key = v_key;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'existed', true); END IF;
  IF length(trim(COALESCE(p ->> 'name', ''))) < 2 THEN RAISE EXCEPTION 'Indique a marca e o modelo da viatura.' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p ->> 'ownerName', ''))) < 2 THEN RAISE EXCEPTION 'Indique o nome do proprietário.' USING ERRCODE = '22023'; END IF;
  INSERT INTO vehicles (company_id, plate, plate_key, name, owner_name, owner_phone, color, notes, extra, created_by)
  VALUES (p_company, v_plate, v_key, trim(p ->> 'name'), trim(p ->> 'ownerName'), NULLIF(trim(p ->> 'ownerPhone'), ''),
          NULLIF(trim(p ->> 'color'), ''), NULLIF(trim(p ->> 'notes'), ''), ps_extra_clean(p -> 'extra'), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO vehicle_visits (company_id, vehicle_id, created_by, updated_by) VALUES (p_company, v_id, auth.uid(), auth.uid()) RETURNING id INTO v_visit;
  PERFORM ps_audit_log(p_company, 'vehicle.create', 'vehicle', v_id::text, NULL, jsonb_build_object('plate', v_plate, 'name', trim(p ->> 'name')));
  RETURN jsonb_build_object('id', v_id, 'visitId', v_visit, 'existed', false);
END $$;

-- Só muda os campos enviados (serve para a ficha e para a planilha do mês).
CREATE OR REPLACE FUNCTION ps_vehicle_update(p_vehicle uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles; v_plate text; v_key text; v_name text; v_owner text;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  v_plate := CASE WHEN p ? 'plate' THEN upper(trim(COALESCE(p ->> 'plate', ''))) ELSE v.plate END;
  v_key := ps_plate_key(v_plate);
  v_name := CASE WHEN p ? 'name' THEN trim(COALESCE(p ->> 'name', '')) ELSE v.name END;
  v_owner := CASE WHEN p ? 'ownerName' THEN trim(COALESCE(p ->> 'ownerName', '')) ELSE v.owner_name END;
  IF length(v_key) < 3 THEN RAISE EXCEPTION 'Indique a matrícula.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM vehicles WHERE company_id = v.company_id AND plate_key = v_key AND id <> v.id) THEN
    RAISE EXCEPTION 'Já existe outra viatura com a matrícula %.', v_plate USING ERRCODE = '23505';
  END IF;
  IF length(v_name) < 2 OR length(v_owner) < 2 THEN RAISE EXCEPTION 'Indique a viatura e o proprietário.' USING ERRCODE = '22023'; END IF;
  UPDATE vehicles SET plate = v_plate, plate_key = v_key, name = v_name, owner_name = v_owner,
         owner_phone = CASE WHEN p ? 'ownerPhone' THEN NULLIF(trim(p ->> 'ownerPhone'), '') ELSE owner_phone END,
         color = CASE WHEN p ? 'color' THEN NULLIF(trim(p ->> 'color'), '') ELSE color END,
         notes = CASE WHEN p ? 'notes' THEN NULLIF(trim(p ->> 'notes'), '') ELSE notes END,
         extra = CASE WHEN jsonb_typeof(p -> 'extra') = 'object' THEN ps_extra_clean(extra || (p -> 'extra')) ELSE extra END,
         updated_at = now()
   WHERE id = v.id;
  IF v_plate <> v.plate THEN
    PERFORM ps_audit_log(v.company_id, 'vehicle.update', 'vehicle', v.id::text, jsonb_build_object('plate', v.plate), jsonb_build_object('plate', v_plate));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_get(p_vehicle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  RETURN jsonb_build_object(
    'id', v.id, 'plate', v.plate, 'name', v.name, 'ownerName', v.owner_name, 'ownerPhone', v.owner_phone, 'color', v.color,
    'notes', v.notes, 'extra', v.extra, 'createdAt', v.created_at, 'createdBy', (SELECT name FROM users WHERE id = v.created_by),
    'coverId', v.cover_photo,
    'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ph.id, 'key', ph.storage_key, 'thumb', ph.thumb_key, 'at', ph.created_at)
                                         ORDER BY ph.created_at) FROM vehicle_photos ph WHERE ph.vehicle_id = v.id), '[]'::jsonb),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', vv.id, 'enteredAt', vv.entered_at, 'finishedAt', vv.finished_at, 'status', vv.status, 'services', to_jsonb(vv.services),
        'description', vv.description, 'mileage', vv.mileage, 'amount', vv.amount, 'extra', vv.extra,
        'by', (SELECT name FROM users WHERE id = COALESCE(vv.updated_by, vv.created_by)), 'updatedAt', vv.updated_at,
        'materials', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('movementId', m.id, 'itemId', i.id, 'name', i.name, 'unit', i.unit, 'quantity', -m.delta) ORDER BY m.created_at)
            FROM stock_movements m JOIN stock_items i ON i.id = m.item_id
           WHERE m.visit_id = vv.id AND m.kind = 'saida' AND NOT m.reverted), '[]'::jsonb)
      ) ORDER BY vv.entered_at DESC)
      FROM vehicle_visits vv WHERE vv.vehicle_id = v.id), '[]'::jsonb));
END $$;

-- Guarda uma entrada; só muda os campos enviados. enteredAt vem como data e hora locais (AAAA-MM-DDTHH:MM).
CREATE OR REPLACE FUNCTION ps_visit_save(p_visit uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE vv vehicle_visits; v_status text;
BEGIN
  SELECT * INTO vv FROM vehicle_visits WHERE id = p_visit;
  PERFORM ps_require(vv.id IS NOT NULL AND ps_manager_ok(vv.company_id, 'oficina'));
  v_status := CASE WHEN p ? 'status' THEN COALESCE(NULLIF(p ->> 'status', ''), 'aberta') ELSE vv.status END;
  IF v_status NOT IN ('aberta', 'concluida') THEN RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE vehicle_visits SET
    services = CASE WHEN p ? 'services' THEN COALESCE((SELECT array_agg(DISTINCT trim(s)) FROM jsonb_array_elements_text(COALESCE(p -> 'services', '[]')) s
                                                        WHERE trim(s) <> ''), '{}') ELSE services END,
    description = CASE WHEN p ? 'description' THEN NULLIF(trim(p ->> 'description'), '') ELSE description END,
    mileage = CASE WHEN p ? 'mileage' THEN NULLIF(regexp_replace(COALESCE(p ->> 'mileage', ''), '\D', '', 'g'), '')::integer ELSE mileage END,
    amount = CASE WHEN p ? 'amount' THEN NULLIF(replace(regexp_replace(COALESCE(p ->> 'amount', ''), '\s', '', 'g'), ',', '.'), '')::numeric ELSE amount END,
    entered_at = CASE WHEN NULLIF(p ->> 'enteredAt', '') IS NOT NULL
                      THEN (p ->> 'enteredAt')::timestamp AT TIME ZONE ps_company_tz(vv.company_id) ELSE entered_at END,
    status = v_status,
    finished_at = CASE WHEN v_status = 'concluida' THEN COALESCE(vv.finished_at, now()) END,
    extra = CASE WHEN jsonb_typeof(p -> 'extra') = 'object' THEN ps_extra_clean(extra || (p -> 'extra')) ELSE extra END,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = vv.id;
  IF v_status <> vv.status THEN
    PERFORM ps_audit_log(vv.company_id, 'vehicle.visit_save', 'vehicle', vv.vehicle_id::text, NULL, jsonb_build_object('visit', vv.id, 'status', v_status));
  END IF;
END $$;

-- Planilha do mês: todas as entradas na oficina no mês (AAAA-MM), com a viatura.
CREATE OR REPLACE FUNCTION ps_workshop_month(p_company uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text := ps_company_tz(p_company); v_start timestamptz; v_end timestamptz;
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company, 'oficina'), 'A função Oficina não está ligada para a sua conta.');
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido.' USING ERRCODE = '22023'; END IF;
  v_start := (p_month || '-01')::date::timestamp AT TIME ZONE v_tz;
  v_end := ((p_month || '-01')::date + interval '1 month')::timestamp AT TIME ZONE v_tz;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', vv.id, 'vehicleId', v.id, 'plate', v.plate, 'name', v.name, 'ownerName', v.owner_name, 'ownerPhone', v.owner_phone,
      'cover', ps_vehicle_cover(v.id), 'vehicleExtra', v.extra,
      'enteredAt', vv.entered_at, 'finishedAt', vv.finished_at, 'status', vv.status, 'services', to_jsonb(vv.services),
      'description', vv.description, 'mileage', vv.mileage, 'amount', vv.amount, 'extra', vv.extra,
      'firstVisit', NOT EXISTS (SELECT 1 FROM vehicle_visits o WHERE o.vehicle_id = v.id AND o.entered_at < vv.entered_at),
      'materials', (SELECT count(*) FROM stock_movements m WHERE m.visit_id = vv.id AND m.kind = 'saida' AND NOT m.reverted),
      'by', (SELECT name FROM users WHERE id = COALESCE(vv.updated_by, vv.created_by))) ORDER BY vv.entered_at)
    FROM vehicle_visits vv JOIN vehicles v ON v.id = vv.vehicle_id
    WHERE vv.company_id = p_company AND vv.entered_at >= v_start AND vv.entered_at < v_end), '[]'::jsonb);
END $$;

-- 5. Fotos das viaturas (ficheiros no Storage, bucket "oficina", pasta empresa/viatura/)
CREATE OR REPLACE FUNCTION ps_vehicle_storage_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_parts text[] := string_to_array(p_name, '/');
BEGIN
  IF cardinality(v_parts) < 3 OR v_parts[1] !~ '^[0-9a-f-]{36}$' OR v_parts[2] !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM vehicles WHERE id = v_parts[2]::uuid AND company_id = v_parts[1]::uuid)
     AND ps_manager_ok(v_parts[1]::uuid, 'oficina');
END $$;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('oficina', 'oficina', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
    DROP POLICY IF EXISTS ps_oficina_insert ON storage.objects;
    DROP POLICY IF EXISTS ps_oficina_read ON storage.objects;
    DROP POLICY IF EXISTS ps_oficina_delete ON storage.objects;
    CREATE POLICY ps_oficina_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'oficina' AND public.ps_vehicle_storage_ok(name));
    CREATE POLICY ps_oficina_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'oficina' AND public.ps_vehicle_storage_ok(name));
    CREATE POLICY ps_oficina_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'oficina' AND public.ps_vehicle_storage_ok(name));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_photo_add(p_vehicle uuid, p_key text, p_thumb text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles; v_id uuid; v_prefix text;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  v_prefix := v.company_id || '/' || v.id || '/';
  IF left(COALESCE(p_key, ''), length(v_prefix)) <> v_prefix OR (p_thumb IS NOT NULL AND left(p_thumb, length(v_prefix)) <> v_prefix) THEN
    RAISE EXCEPTION 'Foto inválida.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM vehicle_photos WHERE vehicle_id = v.id) >= 40 THEN
    RAISE EXCEPTION 'Esta viatura já tem 40 fotos. Apague alguma antes de juntar outra.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO vehicle_photos (company_id, vehicle_id, storage_key, thumb_key, created_by)
  VALUES (v.company_id, v.id, p_key, p_thumb, auth.uid()) RETURNING id INTO v_id;
  IF v.cover_photo IS NULL THEN UPDATE vehicles SET cover_photo = v_id WHERE id = v.id; END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_photo_cover(p_photo uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ph vehicle_photos;
BEGIN
  SELECT * INTO ph FROM vehicle_photos WHERE id = p_photo;
  PERFORM ps_require(ph.id IS NOT NULL AND ps_manager_ok(ph.company_id, 'oficina'));
  UPDATE vehicles SET cover_photo = ph.id, updated_at = now() WHERE id = ph.vehicle_id;
END $$;

-- Apaga a foto e devolve os ficheiros a apagar do Storage.
CREATE OR REPLACE FUNCTION ps_vehicle_photo_delete(p_photo uuid)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ph vehicle_photos;
BEGIN
  SELECT * INTO ph FROM vehicle_photos WHERE id = p_photo;
  PERFORM ps_require(ph.id IS NOT NULL AND ps_manager_ok(ph.company_id, 'oficina'));
  DELETE FROM vehicle_photos WHERE id = ph.id;
  UPDATE vehicles SET cover_photo = (SELECT id FROM vehicle_photos WHERE vehicle_id = ph.vehicle_id ORDER BY created_at DESC LIMIT 1)
   WHERE id = ph.vehicle_id AND cover_photo IS NULL;
  RETURN array_remove(ARRAY[ph.storage_key, ph.thumb_key], NULL);
END $$;

-- 6. Permissões de execução
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ps_custom_field_ok(uuid, text)', 'ps_custom_fields(uuid, text)', 'ps_custom_field_save(uuid, uuid, jsonb)',
    'ps_custom_field_delete(uuid)', 'ps_custom_field_move(uuid, integer)', 'ps_workshop_services_set(uuid, text[])',
    'ps_stock_items(uuid, boolean)', 'ps_stock_save(uuid, uuid, jsonb)', 'ps_stock_month(uuid, text)',
    'ps_vehicle_cover(uuid)', 'ps_vehicle_search(uuid, text)', 'ps_vehicle_register(uuid, jsonb)', 'ps_vehicle_update(uuid, jsonb)',
    'ps_vehicle_get(uuid)', 'ps_visit_save(uuid, jsonb)', 'ps_workshop_month(uuid, text)', 'ps_vehicle_storage_ok(text)',
    'ps_vehicle_photo_add(uuid, text, text)', 'ps_vehicle_photo_cover(uuid)', 'ps_vehicle_photo_delete(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
