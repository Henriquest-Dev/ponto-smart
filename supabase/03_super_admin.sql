-- =====================================================================
-- PontoSmart — criar a conta de Super Admin (produção)
-- 1. Substitua os três valores abaixo.
-- 2. Execute no SQL Editor do Supabase, depois de 01_esquema.sql.
-- A palavra-passe é cifrada com bcrypt pelo próprio PostgreSQL (pgcrypto).
-- Depois de entrar, active a verificação em dois passos em "Segurança da conta".
-- =====================================================================
DO $$
DECLARE
  v_email    text := 'o-seu-email@exemplo.co.mz';   -- ← altere
  v_name     text := 'Administrador PontoSmart';    -- ← altere
  v_password text := 'Troque-Esta-Palavra-Passe-2026';  -- ← altere (mín. 10 caracteres, letras e números)
BEGIN
  IF v_email LIKE '%exemplo%' OR v_password LIKE 'Troque%' THEN
    RAISE EXCEPTION 'Altere o email e a palavra-passe antes de executar.';
  END IF;
  IF length(v_password) < 10 THEN
    RAISE EXCEPTION 'A palavra-passe deve ter pelo menos 10 caracteres.';
  END IF;
  INSERT INTO public.users (email, name, password_hash, is_platform_admin, status)
  VALUES (lower(v_email), v_name, crypt(v_password, gen_salt('bf', 11)), true, 'active')
  ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, password_hash = EXCLUDED.password_hash, status = 'active';
  RAISE NOTICE 'Super Admin pronto: %', lower(v_email);
END $$;
