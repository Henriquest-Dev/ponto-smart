-- Horbit, script 4, parte 11: retira a marcação por link (fica só o QR Code dinâmico e o QR Code fixo).
-- Os links existentes deixam de funcionar. Pode ser executado de novo sem problema.
BEGIN;

UPDATE clock_links SET active = false, shown = false WHERE active OR shown;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ps_clock_link(uuid, double precision, double precision, double precision, text, text, text, boolean, text)',
    'ps_clock_link_save(uuid, uuid, uuid, date, time, time, text, boolean)',
    'ps_clock_link_delete(uuid)', 'ps_my_clock_links(uuid)', 'ps_daily_links(uuid)', 'ps_daily_link_show(uuid, boolean)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
