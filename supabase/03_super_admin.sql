-- =====================================================================
-- PontoSmart — criar a conta de Super Admin (produção)
-- 1. Substitua os três valores abaixo.
-- 2. Execute no SQL Editor do Supabase, depois de 01_esquema.sql.
-- A palavra-passe é cifrada com bcrypt pelo próprio PostgreSQL (pgcrypto).
-- Depois de entrar, active a verificação em dois passos em "Segurança da conta".
-- =====================================================================
DO $$
DECLARE
  v_email    text := 'o-seu-email@exemplo.co.mz';   -- ← altere (email ou nome de utilizador)
  v_name     text := 'Administrador PontoSmart';    -- ← altere
  v_password text := 'Troque-Esta-Palavra-Passe-2026';  -- ← altere (mín. 10 caracteres, letras e números)
  v_schema   text;
  v_hash     text;
BEGIN
  IF v_email LIKE '%exemplo%' OR v_password LIKE 'Troque%' THEN
    RAISE EXCEPTION 'Altere o email e a palavra-passe antes de executar.';
  END IF;
  IF length(v_password) < 10 THEN
    RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 10 caracteres.';
  END IF;
  -- No Supabase o pgcrypto está no schema "extensions"; localmente pode estar em "public".
  SELECT n.nspname INTO v_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
  IF v_schema IS NULL THEN
    CREATE EXTENSION pgcrypto;
    v_schema := 'public';
  END IF;
  EXECUTE format('SELECT %I.crypt($1, %I.gen_salt(''bf'', 11))', v_schema, v_schema) INTO v_hash USING v_password;

  INSERT INTO public.users (email, name, password_hash, is_platform_admin, status)
  VALUES (lower(v_email), v_name, v_hash, true, 'active')
  ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, password_hash = EXCLUDED.password_hash, status = 'active';
  RAISE NOTICE 'Super Admin pronto: %', lower(v_email);
END $$;
