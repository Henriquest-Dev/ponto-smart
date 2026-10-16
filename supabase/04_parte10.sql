-- Horbit, script 4, parte 10: memória do assistente (Orbi) entre conversas.
-- Cada pessoa tem a sua memória por empresa (ou da plataforma, no Super Admin). Pode ser executado de novo sem problema.
BEGIN;

CREATE TABLE IF NOT EXISTS ai_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(content) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_memories_owner_idx ON ai_memories (user_id, company_id, created_at DESC);
ALTER TABLE ai_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ps_own ON ai_memories;
CREATE POLICY ps_own ON ai_memories FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS ps_own_delete ON ai_memories;
CREATE POLICY ps_own_delete ON ai_memories FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON ai_memories FROM anon, authenticated;
GRANT SELECT, DELETE ON ai_memories TO authenticated;

-- Pode usar o assistente neste âmbito (empresa com ai.use, ou Super Admin sem empresa)?
CREATE OR REPLACE FUNCTION ps_ai_scope_ok(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND CASE WHEN p_company IS NULL THEN ps_is_platform_admin() ELSE ps_has_perm(p_company, 'ai.use') END;
$$;

-- Memória de quem está a falar (mais recentes primeiro).
CREATE OR REPLACE FUNCTION ps_ai_memories(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ps_require(ps_ai_scope_ok(p_company), 'Sem acesso ao assistente.');
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'content', content, 'at', created_at) ORDER BY created_at DESC), '[]')
            FROM (SELECT * FROM ai_memories WHERE user_id = auth.uid() AND company_id IS NOT DISTINCT FROM p_company
                  ORDER BY created_at DESC LIMIT 50) m);
END $$;

-- Guarda factos novos (sem repetidos); mantém no máximo 40 por pessoa e âmbito.
CREATE OR REPLACE FUNCTION ps_ai_memory_add(p_company uuid, p_items text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  PERFORM ps_require(ps_ai_scope_ok(p_company), 'Sem acesso ao assistente.');
  INSERT INTO ai_memories (user_id, company_id, content)
  SELECT auth.uid(), p_company, t
    FROM (SELECT DISTINCT ON (lower(t)) t FROM (SELECT left(trim(x), 300) AS t FROM unnest(COALESCE(p_items, '{}')) x) a
           WHERE length(t) >= 3) i
   WHERE NOT EXISTS (SELECT 1 FROM ai_memories m WHERE m.user_id = auth.uid() AND m.company_id IS NOT DISTINCT FROM p_company
                       AND lower(m.content) = lower(i.t));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM ai_memories WHERE id IN (
    SELECT id FROM ai_memories WHERE user_id = auth.uid() AND company_id IS NOT DISTINCT FROM p_company
     ORDER BY created_at DESC OFFSET 40);
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION ps_ai_memory_delete(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM ai_memories WHERE id = p_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION ps_ai_memory_clear(p_company uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM ai_memories WHERE user_id = auth.uid() AND company_id IS NOT DISTINCT FROM p_company;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['ps_ai_scope_ok(uuid)', 'ps_ai_memories(uuid)', 'ps_ai_memory_add(uuid, text[])', 'ps_ai_memory_delete(uuid)', 'ps_ai_memory_clear(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
