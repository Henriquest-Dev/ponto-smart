#!/usr/bin/env bash
# Gera supabase/01_esquema.sql e supabase/02_dados_demonstracao.sql a partir de uma
# base local acabada de criar com: npm run db:reset
# Uso: DATABASE_URL=postgres://… bash scripts/export-supabase.sh
set -euo pipefail
DB="${DATABASE_URL:?Defina DATABASE_URL}"
OUT=supabase
mkdir -p "$OUT"

clean() {
  grep -vE '^(SET |SELECT pg_catalog.set_config|--$|-- Dumped|-- PostgreSQL database dump|\\restrict|\\unrestrict)' \
    | sed '/^-- Data for Name/d; /^-- Name: /d' | cat -s
}

{
  echo '-- ====================================================================='
  echo '-- PontoSmart — esquema completo para o Supabase (SQL Editor)'
  echo '-- Gerado a partir das migrações em drizzle/. Executar UMA vez numa base vazia.'
  echo '-- Inclui: extensões (PostGIS), tabelas, índices, triggers de integridade,'
  echo '-- bloqueio da API REST do Supabase (RLS) e dados de referência'
  echo '-- (papéis, permissões, planos e regras salariais por validar).'
  echo '-- ====================================================================='
  echo
  echo 'BEGIN;'
  for f in drizzle/*.sql; do
    echo '-- ---------------------------------------------------------------------'
    echo "-- $f"
    echo '-- ---------------------------------------------------------------------'
    sed 's/--> statement-breakpoint//' "$f"
    echo
  done
  echo '-- Registo das migrações (permite usar "npm run db:migrate" no futuro)'
  echo 'CREATE SCHEMA IF NOT EXISTS drizzle;'
  echo 'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);'
  pg_dump --data-only --column-inserts --no-owner --no-privileges -n drizzle "$DB" | clean
  echo "SELECT setval('drizzle.__drizzle_migrations_id_seq', (SELECT max(id) FROM drizzle.__drizzle_migrations));"
  echo '-- Dados de referência'
  pg_dump --data-only --column-inserts --rows-per-insert=200 --no-owner --no-privileges \
    -t public.roles -t public.permissions -t public.role_permissions -t public.subscription_plans "$DB" | clean
  psql -tA "$DB" -c "select 'INSERT INTO public.payroll_rule_versions (id, company_id, jurisdiction, rule_code, name, version, params, effective_from, effective_to, validated, validated_by, source_reference, created_at) VALUES (' || quote_literal(id) || ', NULL, ' || quote_literal(jurisdiction) || ', ' || quote_literal(rule_code) || ', ' || quote_literal(name) || ', ' || version || ', ' || quote_literal(params::text) || '::jsonb, ' || quote_literal(effective_from) || ', NULL, false, NULL, ' || quote_nullable(source_reference) || ', now());' from payroll_rule_versions where company_id is null"
  echo
  echo 'COMMIT;'
} > "$OUT/01_esquema.sql"

{
  echo '-- ====================================================================='
  echo '-- PontoSmart — DADOS DE DEMONSTRAÇÃO (opcional). Executar DEPOIS de 01_esquema.sql.'
  echo '-- Todos os nomes, NUIT e valores são fictícios.'
  echo '-- Contas de demonstração com a palavra-passe PontoSmart2026 — NÃO usar em produção'
  echo '-- sem alterar as palavras-passe (ou apague as empresas de demonstração).'
  echo '-- ====================================================================='
  echo 'BEGIN;'
  pg_dump --data-only --column-inserts --rows-per-insert=300 --no-owner --no-privileges -n public \
    -T public.roles -T public.permissions -T public.role_permissions -T public.subscription_plans \
    -T public.payroll_rule_versions -T public.spatial_ref_sys -T public.rate_limits -T public.sessions "$DB" | clean
  echo 'COMMIT;'
} > "$OUT/02_dados_demonstracao.sql"

echo "Gerados: $OUT/01_esquema.sql e $OUT/02_dados_demonstracao.sql"
