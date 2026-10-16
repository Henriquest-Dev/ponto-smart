-- Horbit, script 4, parte 12: painel do Gerente.
-- Papel "Gerente" (marca ponto como um colaborador e tem funções de gestão), gestão de estoque para todos os gerentes
-- e funções avançadas que a empresa liga por gerente (a primeira: Oficina, com viaturas por matrícula e relatórios).
-- Pode ser executado de novo sem problema.
BEGIN;

-- 1. Papel, permissões e funções avançadas por gerente
INSERT INTO roles (code, name, description)
VALUES ('manager', 'Gerente', 'Marca ponto como colaborador e gere o estoque; pode ter funções avançadas (ex.: Oficina).')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO permissions (code, module, description) VALUES
  ('stock.manage', 'gestao', 'Gerir o estoque (materiais, entradas, saídas e contagens)'),
  ('workshop.manage', 'gestao', 'Oficina: registar viaturas, trabalhos feitos e relatórios')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('manager', ARRAY['self.absence', 'self.clock', 'self.history', 'self.payslips', 'stock.manage', 'workshop.manage']),
  ('owner', ARRAY['stock.manage', 'workshop.manage']),
  ('admin', ARRAY['stock.manage', 'workshop.manage'])
) AS m(role, perms)
JOIN roles r ON r.code = m.role
JOIN permissions p ON p.code = ANY (m.perms)
ON CONFLICT DO NOTHING;

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT '{}';

-- Funções avançadas conhecidas (acrescentar aqui as próximas).
CREATE OR REPLACE FUNCTION ps_manager_modules_known() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['oficina'] $$;

-- Pode usar o estoque (p_module NULL) ou uma função avançada? O proprietário e o administrador vêem tudo;
-- o gerente só as funções avançadas que a empresa lhe ligou.
CREATE OR REPLACE FUNCTION ps_manager_ok(p_company uuid, p_module text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_module IS NULL THEN ps_has_perm(p_company, 'stock.manage')
    WHEN p_module = 'oficina' THEN ps_has_perm(p_company, 'workshop.manage') AND (
      COALESCE(ps_role(p_company), '') IN ('owner', 'admin')
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = auth.uid() AND m.company_id = p_company AND m.active
                   AND 'oficina' = ANY (m.modules)))
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION ps_manager_modules_set(p_employee uuid, p_modules text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_mods text[];
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(v_emp.company_id, 'users.manage'), 'Só quem gere contas pode mudar as funções do gerente.');
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_mods
    FROM unnest(COALESCE(p_modules, '{}')) x WHERE x = ANY (ps_manager_modules_known());
  UPDATE memberships SET modules = v_mods WHERE user_id = v_emp.user_id AND company_id = v_emp.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este colaborador ainda não tem acesso ao Horbit.' USING ERRCODE = '22023'; END IF;
  PERFORM ps_audit_log(v_emp.company_id, 'employee.modules_set', 'employee', v_emp.id::text, NULL, jsonb_build_object('modules', v_mods));
  RETURN v_mods;
END $$;

-- ps_me com as funções avançadas (as minhas e as ligadas na empresa).
CREATE OR REPLACE FUNCTION ps_me() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user users;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = auth.uid();
  IF v_user.id IS NULL THEN RETURN NULL; END IF;
  IF v_user.status = 'disabled' THEN RAISE EXCEPTION 'Conta desactivada. Contacte o administrador.' USING ERRCODE = '42501'; END IF;
  IF v_user.last_login_at IS NULL OR v_user.last_login_at < now() - interval '10 minutes' THEN
    UPDATE users SET last_login_at = now() WHERE id = v_user.id;
  END IF;
  RETURN jsonb_build_object(
    'id', v_user.id, 'login', v_user.email, 'name', v_user.name, 'isPlatformAdmin', v_user.is_platform_admin,
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'companyId', c.id, 'companyName', c.name, 'companyStatus', c.status, 'timezone', c.timezone,
        'currency', c.currency, 'settings', c.settings, 'role', r.code, 'roleName', r.name,
        'employeeId', (SELECT e.id FROM employees e WHERE e.company_id = c.id AND e.user_id = v_user.id LIMIT 1),
        'permissions', (SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]') FROM role_permissions rp
                          JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id),
        'teamDepartments', (SELECT COALESCE(jsonb_agg(d.id), '[]') FROM departments d
                              WHERE d.company_id = c.id AND d.manager_user_id = v_user.id),
        'modules', to_jsonb(m.modules),
        'companyModules', (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]') FROM memberships m2, unnest(m2.modules) x
                             WHERE m2.company_id = c.id AND m2.active)
      ) ORDER BY c.name)
      FROM memberships m JOIN companies c ON c.id = m.company_id JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = v_user.id AND m.active AND c.status IN ('trial', 'active')), '[]'::jsonb)
  );
END $$;

-- ps_set_access aceita o papel "manager".
CREATE OR REPLACE FUNCTION ps_set_access(p_employee uuid, p_login text, p_password text, p_role text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_emp employees; v_user uuid; v_role uuid; v_role_code text := NULLIF(p_role, ''); v_login text := lower(trim(p_login));
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee;
  IF v_role_code IS NULL THEN
    SELECT r.code INTO v_role_code FROM memberships m JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = v_emp.user_id AND m.company_id = v_emp.company_id;
    v_role_code := COALESCE(v_role_code, 'employee');
  END IF;
  PERFORM ps_require(v_emp.id IS NOT NULL AND ps_has_perm(v_emp.company_id, 'employees.manage'));
  IF v_role_code NOT IN ('employee', 'manager', 'supervisor', 'hr', 'finance', 'admin', 'owner') THEN
    RAISE EXCEPTION 'Papel inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_role_code <> 'employee' THEN
    PERFORM ps_require(ps_has_perm(v_emp.company_id, 'users.manage'), 'Só quem gere contas pode atribuir este papel.');
  END IF;
  IF v_role_code = 'owner' THEN
    PERFORM ps_require(ps_role(v_emp.company_id) = 'owner', 'Só o proprietário pode criar outro proprietário.');
  END IF;
  IF length(COALESCE(v_login, '')) < 3 OR v_login !~ '^[a-z0-9._@+-]+$' THEN
    RAISE EXCEPTION 'Acesso inválido: use letras, números, ponto, hífen ou um email.' USING ERRCODE = '22023';
  END IF;
  v_user := v_emp.user_id;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM users WHERE email = v_login;
    IF v_user IS NOT NULL AND EXISTS (SELECT 1 FROM employees WHERE user_id = v_user AND company_id = v_emp.company_id) THEN
      RAISE EXCEPTION 'Esse acesso já está atribuído a outro colaborador.' USING ERRCODE = '23505';
    END IF;
    IF v_user IS NOT NULL THEN
      RAISE EXCEPTION 'O acesso "%" já existe. Escolha outro.', v_login USING ERRCODE = '23505';
    END IF;
    IF p_password IS NULL OR length(p_password) < 8 THEN
      RAISE EXCEPTION 'Defina uma palavra-passe com pelo menos 8 caracteres.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO users (email, name, password_hash) VALUES (v_login, v_emp.full_name, 'supabase-auth') RETURNING id INTO v_user;
    UPDATE employees SET user_id = v_user WHERE id = v_emp.id;
  ELSE
    IF EXISTS (SELECT 1 FROM users WHERE email = v_login AND id <> v_user) THEN
      RAISE EXCEPTION 'O acesso "%" já existe. Escolha outro.', v_login USING ERRCODE = '23505';
    END IF;
    UPDATE users SET email = v_login, name = v_emp.full_name, status = 'active' WHERE id = v_user;
  END IF;
  PERFORM ps_auth_upsert(v_user, v_login, NULLIF(p_password, ''));
  SELECT id INTO v_role FROM roles WHERE code = v_role_code;
  INSERT INTO memberships (user_id, company_id, role_id, active) VALUES (v_user, v_emp.company_id, v_role, v_emp.status = 'active')
  ON CONFLICT (user_id, company_id) DO UPDATE SET role_id = EXCLUDED.role_id, active = EXCLUDED.active;
  -- Quem deixa de ser gerente perde as funções avançadas.
  IF v_role_code <> 'manager' THEN
    UPDATE memberships SET modules = '{}' WHERE user_id = v_user AND company_id = v_emp.company_id AND modules <> '{}';
  END IF;
  PERFORM ps_audit_log(v_emp.company_id, 'employee.access_set', 'employee', v_emp.id::text, NULL,
                       jsonb_build_object('login', v_login, 'role', v_role_code, 'passwordChanged', p_password IS NOT NULL AND p_password <> ''));
  RETURN v_user;
END $$;

-- 2. Estoque (para todos os gerentes)
CREATE TABLE IF NOT EXISTS stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  unit text NOT NULL DEFAULT 'un',
  quantity numeric(14, 3) NOT NULL DEFAULT 0,
  min_quantity numeric(14, 3) NOT NULL DEFAULT 0,
  notes text,
  active boolean NOT NULL DEFAULT true,
  last_counted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_company_name_uq ON stock_items (company_id, lower(name));

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES stock_items (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('entrada', 'saida', 'contagem')),
  delta numeric(14, 3) NOT NULL,
  balance_after numeric(14, 3) NOT NULL,
  note text,
  visit_id uuid,
  reverted boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON stock_movements (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_company_idx ON stock_movements (company_id, created_at DESC);

-- 3. Oficina: viaturas (a matrícula identifica o carro) e cada entrada na oficina com o que foi feito
CREATE OR REPLACE FUNCTION ps_plate_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  plate text NOT NULL,
  plate_key text NOT NULL,
  name text NOT NULL,
  owner_name text NOT NULL,
  owner_phone text,
  color text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_company_plate_uq ON vehicles (company_id, plate_key);

CREATE TABLE IF NOT EXISTS vehicle_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  entered_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'concluida')),
  services text[] NOT NULL DEFAULT '{}',
  description text,
  mileage integer,
  amount numeric(14, 2),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_visits_vehicle_idx ON vehicle_visits (vehicle_id, entered_at DESC);

-- Só através das funções abaixo (que verificam o papel e a função avançada).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_items', 'stock_movements', 'vehicles', 'vehicle_visits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', t); END IF;
  END LOOP;
END $$;

-- 4. Funções do estoque
CREATE OR REPLACE FUNCTION ps_stock_state(p_qty numeric, p_min numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_qty <= 0 THEN 'esgotado' WHEN p_qty <= p_min THEN 'a_acabar' ELSE 'ok' END
$$;

CREATE OR REPLACE FUNCTION ps_stock_items(p_company uuid, p_archived boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company));
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'category', i.category, 'unit', i.unit, 'quantity', i.quantity,
      'minQuantity', i.min_quantity, 'notes', i.notes, 'active', i.active, 'state', ps_stock_state(i.quantity, i.min_quantity),
      'lastCountedAt', i.last_counted_at, 'updatedAt', i.updated_at) ORDER BY lower(i.name))
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
    INSERT INTO stock_items (company_id, name, category, unit, quantity, min_quantity, notes, created_by)
    VALUES (p_company, v_name, NULLIF(trim(p ->> 'category'), ''), COALESCE(NULLIF(trim(p ->> 'unit'), ''), 'un'), v_qty, v_min,
            NULLIF(trim(p ->> 'notes'), ''), auth.uid())
    RETURNING id INTO v_id;
    IF v_qty > 0 THEN
      INSERT INTO stock_movements (company_id, item_id, kind, delta, balance_after, note, created_by)
      VALUES (p_company, v_id, 'entrada', v_qty, v_qty, 'Quantidade inicial', auth.uid());
    END IF;
    PERFORM ps_audit_log(p_company, 'stock.item_create', 'stock_item', v_id::text, NULL, jsonb_build_object('name', v_name, 'quantity', v_qty));
  ELSE
    UPDATE stock_items SET name = v_name, category = NULLIF(trim(p ->> 'category'), ''),
           unit = COALESCE(NULLIF(trim(p ->> 'unit'), ''), 'un'), min_quantity = v_min, notes = NULLIF(trim(p ->> 'notes'), ''), updated_at = now()
     WHERE id = v_id AND company_id = p_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE = 'P0002'; END IF;
    PERFORM ps_audit_log(p_company, 'stock.item_update', 'stock_item', v_id::text, NULL, jsonb_build_object('name', v_name));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION ps_stock_archive(p_item uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item stock_items;
BEGIN
  SELECT * INTO v_item FROM stock_items WHERE id = p_item;
  PERFORM ps_require(v_item.id IS NOT NULL AND ps_manager_ok(v_item.company_id));
  UPDATE stock_items SET active = p_active, updated_at = now() WHERE id = p_item;
  PERFORM ps_audit_log(v_item.company_id, CASE WHEN p_active THEN 'stock.item_restore' ELSE 'stock.item_archive' END, 'stock_item', p_item::text, NULL,
                       jsonb_build_object('name', v_item.name));
END $$;

-- Entrada (chegou material), saída (gastou-se) ou contagem (contou-se o que há e acerta-se o valor).
CREATE OR REPLACE FUNCTION ps_stock_move(p_item uuid, p_kind text, p_qty numeric, p_note text DEFAULT NULL, p_visit uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item stock_items; v_delta numeric; v_new numeric;
BEGIN
  SELECT * INTO v_item FROM stock_items WHERE id = p_item FOR UPDATE;
  PERFORM ps_require(v_item.id IS NOT NULL AND ps_manager_ok(v_item.company_id));
  IF p_visit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicle_visits WHERE id = p_visit AND company_id = v_item.company_id) THEN
    RAISE EXCEPTION 'Trabalho não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_kind NOT IN ('entrada', 'saida', 'contagem') THEN RAISE EXCEPTION 'Movimento inválido.' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty < 0 OR (p_kind <> 'contagem' AND p_qty = 0) THEN
    RAISE EXCEPTION 'Indique uma quantidade válida.' USING ERRCODE = '22023';
  END IF;
  v_delta := CASE p_kind WHEN 'entrada' THEN p_qty WHEN 'saida' THEN -p_qty ELSE p_qty - v_item.quantity END;
  v_new := v_item.quantity + v_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Só há % % de "%" em estoque.', trim(to_char(v_item.quantity, 'FM999999990.###')), v_item.unit, v_item.name USING ERRCODE = '22023';
  END IF;
  UPDATE stock_items SET quantity = v_new, updated_at = now(),
         last_counted_at = CASE WHEN p_kind = 'contagem' THEN now() ELSE last_counted_at END
   WHERE id = p_item;
  INSERT INTO stock_movements (company_id, item_id, kind, delta, balance_after, note, visit_id, created_by)
  VALUES (v_item.company_id, p_item, p_kind, v_delta, v_new, NULLIF(trim(p_note), ''), p_visit, auth.uid());
  RETURN jsonb_build_object('quantity', v_new, 'state', ps_stock_state(v_new, v_item.min_quantity));
END $$;

CREATE OR REPLACE FUNCTION ps_stock_history(p_item uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM stock_items WHERE id = p_item;
  PERFORM ps_require(v_company IS NOT NULL AND ps_manager_ok(v_company));
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x ->> 'at' DESC) FROM (
      SELECT jsonb_build_object('id', m.id, 'kind', m.kind, 'delta', m.delta, 'balance', m.balance_after, 'note', m.note,
             'at', m.created_at, 'by', u.name, 'plate', v.plate) x
        FROM stock_movements m
        LEFT JOIN users u ON u.id = m.created_by
        LEFT JOIN vehicle_visits vv ON vv.id = m.visit_id
        LEFT JOIN vehicles v ON v.id = vv.vehicle_id
       WHERE m.item_id = p_item ORDER BY m.created_at DESC LIMIT 150) s), '[]'::jsonb);
END $$;

-- Resumo do mês (AAAA-MM): para cada material, quanto havia no início, entradas, saídas, acertos de contagem e no fim.
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
      'state', ps_stock_state(s.final, i.min_quantity), 'lastCountedAt', i.last_counted_at) ORDER BY lower(i.name))
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

-- 5. Funções da oficina
CREATE OR REPLACE FUNCTION ps_vehicle_search(p_company uuid, p_q text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q text := trim(COALESCE(p_q, '')); v_key text := ps_plate_key(p_q);
BEGIN
  PERFORM ps_require(ps_manager_ok(p_company, 'oficina'), 'A função Oficina não está ligada para a sua conta.');
  RETURN COALESCE((
    SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('id', v.id, 'plate', v.plate, 'name', v.name, 'ownerName', v.owner_name, 'ownerPhone', v.owner_phone,
             'color', v.color, 'createdAt', v.created_at, 'visits', (SELECT count(*) FROM vehicle_visits WHERE vehicle_id = v.id),
             'lastVisit', (SELECT max(entered_at) FROM vehicle_visits WHERE vehicle_id = v.id),
             'open', EXISTS (SELECT 1 FROM vehicle_visits WHERE vehicle_id = v.id AND status = 'aberta')) x
        FROM vehicles v
       WHERE v.company_id = p_company
         AND (v_q = '' OR (v_key <> '' AND v.plate_key LIKE '%' || v_key || '%')
              OR v.name ILIKE '%' || v_q || '%' OR v.owner_name ILIKE '%' || v_q || '%' OR v.owner_phone ILIKE '%' || v_q || '%')
       ORDER BY (v_key <> '' AND v.plate_key LIKE v_key || '%') DESC,
                COALESCE((SELECT max(entered_at) FROM vehicle_visits WHERE vehicle_id = v.id), v.created_at) DESC
       LIMIT 60) s), '[]'::jsonb);
END $$;

-- Regista a viatura e abre logo a entrada na oficina (dia e hora gravados automaticamente).
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
  INSERT INTO vehicles (company_id, plate, plate_key, name, owner_name, owner_phone, color, notes, created_by)
  VALUES (p_company, v_plate, v_key, trim(p ->> 'name'), trim(p ->> 'ownerName'), NULLIF(trim(p ->> 'ownerPhone'), ''),
          NULLIF(trim(p ->> 'color'), ''), NULLIF(trim(p ->> 'notes'), ''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO vehicle_visits (company_id, vehicle_id, created_by, updated_by) VALUES (p_company, v_id, auth.uid(), auth.uid()) RETURNING id INTO v_visit;
  PERFORM ps_audit_log(p_company, 'vehicle.create', 'vehicle', v_id::text, NULL, jsonb_build_object('plate', v_plate, 'name', trim(p ->> 'name')));
  RETURN jsonb_build_object('id', v_id, 'visitId', v_visit, 'existed', false);
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_update(p_vehicle uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles; v_plate text := upper(trim(COALESCE(p ->> 'plate', ''))); v_key text;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  v_key := ps_plate_key(v_plate);
  IF length(v_key) < 3 THEN RAISE EXCEPTION 'Indique a matrícula.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM vehicles WHERE company_id = v.company_id AND plate_key = v_key AND id <> v.id) THEN
    RAISE EXCEPTION 'Já existe outra viatura com a matrícula %.', v_plate USING ERRCODE = '23505';
  END IF;
  IF length(trim(COALESCE(p ->> 'name', ''))) < 2 OR length(trim(COALESCE(p ->> 'ownerName', ''))) < 2 THEN
    RAISE EXCEPTION 'Indique a viatura e o proprietário.' USING ERRCODE = '22023';
  END IF;
  UPDATE vehicles SET plate = v_plate, plate_key = v_key, name = trim(p ->> 'name'), owner_name = trim(p ->> 'ownerName'),
         owner_phone = NULLIF(trim(p ->> 'ownerPhone'), ''), color = NULLIF(trim(p ->> 'color'), ''), notes = NULLIF(trim(p ->> 'notes'), ''),
         updated_at = now()
   WHERE id = v.id;
  PERFORM ps_audit_log(v.company_id, 'vehicle.update', 'vehicle', v.id::text, jsonb_build_object('plate', v.plate), jsonb_build_object('plate', v_plate));
END $$;

CREATE OR REPLACE FUNCTION ps_vehicle_get(p_vehicle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  RETURN jsonb_build_object(
    'id', v.id, 'plate', v.plate, 'name', v.name, 'ownerName', v.owner_name, 'ownerPhone', v.owner_phone, 'color', v.color,
    'notes', v.notes, 'createdAt', v.created_at, 'createdBy', (SELECT name FROM users WHERE id = v.created_by),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', vv.id, 'enteredAt', vv.entered_at, 'finishedAt', vv.finished_at, 'status', vv.status, 'services', to_jsonb(vv.services),
        'description', vv.description, 'mileage', vv.mileage, 'amount', vv.amount,
        'by', (SELECT name FROM users WHERE id = COALESCE(vv.updated_by, vv.created_by)), 'updatedAt', vv.updated_at,
        'materials', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('movementId', m.id, 'itemId', i.id, 'name', i.name, 'unit', i.unit, 'quantity', -m.delta) ORDER BY m.created_at)
            FROM stock_movements m JOIN stock_items i ON i.id = m.item_id
           WHERE m.visit_id = vv.id AND m.kind = 'saida' AND NOT m.reverted), '[]'::jsonb)
      ) ORDER BY vv.entered_at DESC)
      FROM vehicle_visits vv WHERE vv.vehicle_id = v.id), '[]'::jsonb));
END $$;

-- Nova entrada de uma viatura que já existe (se já houver uma aberta, devolve essa).
CREATE OR REPLACE FUNCTION ps_visit_open(p_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles; v_visit uuid;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle;
  PERFORM ps_require(v.id IS NOT NULL AND ps_manager_ok(v.company_id, 'oficina'));
  SELECT id INTO v_visit FROM vehicle_visits WHERE vehicle_id = v.id AND status = 'aberta' ORDER BY entered_at DESC LIMIT 1;
  IF v_visit IS NOT NULL THEN RETURN v_visit; END IF;
  INSERT INTO vehicle_visits (company_id, vehicle_id, created_by, updated_by) VALUES (v.company_id, v.id, auth.uid(), auth.uid()) RETURNING id INTO v_visit;
  PERFORM ps_audit_log(v.company_id, 'vehicle.visit_open', 'vehicle', v.id::text, NULL, jsonb_build_object('plate', v.plate));
  RETURN v_visit;
END $$;

CREATE OR REPLACE FUNCTION ps_visit_save(p_visit uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE vv vehicle_visits; v_status text := COALESCE(NULLIF(p ->> 'status', ''), 'aberta');
BEGIN
  SELECT * INTO vv FROM vehicle_visits WHERE id = p_visit;
  PERFORM ps_require(vv.id IS NOT NULL AND ps_manager_ok(vv.company_id, 'oficina'));
  IF v_status NOT IN ('aberta', 'concluida') THEN RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE vehicle_visits SET
    services = COALESCE((SELECT array_agg(DISTINCT trim(s)) FROM jsonb_array_elements_text(COALESCE(p -> 'services', '[]')) s WHERE trim(s) <> ''), '{}'),
    description = NULLIF(trim(p ->> 'description'), ''),
    mileage = NULLIF(p ->> 'mileage', '')::integer,
    amount = NULLIF(p ->> 'amount', '')::numeric,
    status = v_status,
    finished_at = CASE WHEN v_status = 'concluida' THEN COALESCE(vv.finished_at, now()) END,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = vv.id;
  PERFORM ps_audit_log(vv.company_id, 'vehicle.visit_save', 'vehicle', vv.vehicle_id::text, NULL,
                       jsonb_build_object('visit', vv.id, 'status', v_status));
END $$;

CREATE OR REPLACE FUNCTION ps_visit_material_add(p_visit uuid, p_item uuid, p_qty numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE vv vehicle_visits; v_plate text;
BEGIN
  SELECT * INTO vv FROM vehicle_visits WHERE id = p_visit;
  PERFORM ps_require(vv.id IS NOT NULL AND ps_manager_ok(vv.company_id, 'oficina'));
  PERFORM ps_require(EXISTS (SELECT 1 FROM stock_items WHERE id = p_item AND company_id = vv.company_id AND active), 'Material não encontrado.');
  SELECT plate INTO v_plate FROM vehicles WHERE id = vv.vehicle_id;
  RETURN ps_stock_move(p_item, 'saida', p_qty, 'Usado na viatura ' || v_plate, p_visit);
END $$;

-- Retira um material do trabalho: volta ao estoque.
CREATE OR REPLACE FUNCTION ps_visit_material_remove(p_movement uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m stock_movements; v_plate text;
BEGIN
  SELECT * INTO m FROM stock_movements WHERE id = p_movement AND kind = 'saida' AND visit_id IS NOT NULL AND NOT reverted;
  PERFORM ps_require(m.id IS NOT NULL AND ps_manager_ok(m.company_id, 'oficina'));
  SELECT v.plate INTO v_plate FROM vehicle_visits vv JOIN vehicles v ON v.id = vv.vehicle_id WHERE vv.id = m.visit_id;
  UPDATE stock_movements SET reverted = true WHERE id = m.id;
  PERFORM ps_stock_move(m.item_id, 'entrada', -m.delta, 'Devolvido da viatura ' || COALESCE(v_plate, ''), NULL);
END $$;

CREATE OR REPLACE FUNCTION ps_visit_delete(p_visit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE vv vehicle_visits; r record;
BEGIN
  SELECT * INTO vv FROM vehicle_visits WHERE id = p_visit;
  PERFORM ps_require(vv.id IS NOT NULL AND ps_manager_ok(vv.company_id, 'oficina'));
  FOR r IN SELECT id FROM stock_movements WHERE visit_id = vv.id AND kind = 'saida' AND NOT reverted LOOP
    PERFORM ps_visit_material_remove(r.id);
  END LOOP;
  UPDATE stock_movements SET visit_id = NULL WHERE visit_id = vv.id;
  DELETE FROM vehicle_visits WHERE id = vv.id;
  PERFORM ps_audit_log(vv.company_id, 'vehicle.visit_delete', 'vehicle', vv.vehicle_id::text, NULL, jsonb_build_object('visit', vv.id));
END $$;

-- 6. Permissões de execução
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ps_manager_ok(uuid, text)', 'ps_manager_modules_set(uuid, text[])', 'ps_me()', 'ps_set_access(uuid, text, text, text)',
    'ps_stock_items(uuid, boolean)', 'ps_stock_save(uuid, uuid, jsonb)', 'ps_stock_archive(uuid, boolean)',
    'ps_stock_move(uuid, text, numeric, text, uuid)', 'ps_stock_history(uuid)', 'ps_stock_month(uuid, text)',
    'ps_vehicle_search(uuid, text)', 'ps_vehicle_register(uuid, jsonb)', 'ps_vehicle_update(uuid, jsonb)', 'ps_vehicle_get(uuid)',
    'ps_visit_open(uuid)', 'ps_visit_save(uuid, jsonb)', 'ps_visit_material_add(uuid, uuid, numeric)',
    'ps_visit_material_remove(uuid)', 'ps_visit_delete(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
