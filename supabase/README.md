# Base de dados no Supabase

Três ficheiros para executar no **SQL Editor** do Supabase (Dashboard → SQL Editor → New query), por esta ordem:

| Ficheiro | Obrigatório | O que faz |
|---|---|---|
| `01_esquema.sql` | sim | Activa o PostGIS, cria as 46 tabelas, índices e triggers de integridade, bloqueia a API REST do Supabase (RLS) e insere os dados de referência (papéis, permissões, planos e regras salariais por validar). Regista as migrações para que `npm run db:migrate` funcione no futuro. |
| `02_dados_demonstracao_parte1.sql` … `parte5.sql` | não | Empresa fictícia com ~2,5 meses de marcações, justificações, salários e recibos, em 5 partes que cabem no editor (executar todas, por ordem). Contas com a palavra-passe `PontoSmart2026` — só para demonstração. |
| `03_super_admin.sql` | sim, em produção | Cria a sua conta de Super Admin. Altere o email, o nome e a palavra-passe no topo do ficheiro antes de executar. |

Execute cada ficheiro uma única vez, numa base vazia, e espere pela mensagem *Success* antes de passar ao seguinte.

## Ligar a app (Netlify)

1. Supabase → **Connect** → **Connection string** → **Transaction pooler** (porta `6543`).
2. Substitua `[YOUR-PASSWORD]` pela palavra-passe da base de dados (Project Settings → Database).
3. Na Netlify, defina `DATABASE_URL` com esse valor e faça novo deploy.
4. Verifique `https://<site>/api/health` → `{"ok":true,"db":"up"}`.

A app liga-se directamente ao PostgreSQL. Não usa a chave *publishable* nem a API REST do Supabase.

## Segurança: porque é que o RLS está activo

O Supabase expõe automaticamente as tabelas do schema `public` pela API REST, acessível com a chave *publishable* (que é pública). O `01_esquema.sql` activa o RLS em todas as tabelas e retira as permissões aos papéis `anon` e `authenticated`, por isso essa API não lê nem escreve dados. A app não é afectada porque se liga como dona das tabelas.

Se no futuro adicionar tabelas, crie também uma migração que active o RLS nelas.

## Alternativa: linha de comandos

```bash
export DATABASE_URL="postgresql://postgres.<ref>:<palavra-passe>@aws-0-<região>.pooler.supabase.com:6543/postgres"
npm run db:migrate          # equivalente ao 01_esquema.sql (sem dados de referência)
npm run db:seed             # dados de demonstração + papéis, permissões e planos
```

Para regenerar estes ficheiros após alterar o esquema: `npm run db:reset && npm run supabase:sql`.
