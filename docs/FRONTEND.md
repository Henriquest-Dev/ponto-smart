# Frontend estático (GitHub Pages) + Supabase — convenções

O site é um export estático do Next.js (`output: "export"`, `trailingSlash: true`, basePath `/ponto-smart` no GitHub Pages).
Não há servidor próprio: tudo o que é "servidor" vive no Supabase (Auth, RLS, funções SQL `ps_*`, Storage, Edge Function).

## Regras

- Todas as páginas das áreas são componentes cliente (`"use client"`). Sem server actions, route handlers, `next/headers`, `cookies()`, `redirect()` do servidor, nem segmentos dinâmicos `[id]`. Use `?id=` e `useQueryParam("id")` (de `@/lib/sb/use-data`; o `<Area>` já tem `<Suspense>`).
- Ligações internas com barra final: `/empresa/colaboradores/`, `/empresa/colaboradores/ficha/?id=...`. O `next/link` trata do basePath. Para `window.location`/`window.open` use `withBase()`.
- Layouts de área já existem (`src/app/{app,empresa,admin}/layout.tsx` → `<Area kind=...>`), que garantem sessão e papel.

## Dados

- `sb()` — cliente Supabase. `rpc(nome, args)` — chama função SQL e lança `Error` com mensagem legível (pt-PT). `must(res)` — desembrulha `{data,error}`. `errorMessage(err)`.
- `useData(fn, deps)` → `{ data, error, loading, reload }`.
- `useCompany()` → `{ company, companyId, can, me, tz }`. `can("payroll.view")` usa as permissões do papel. `company.role`, `company.employeeId`, `company.teamDepartments`, `company.settings`, `company.currency`.
- `useSession()` → `{ me, company, refresh, signOut }`.
- Formulários: `ActionForm` (de `@/components/ui/form`) aceita `action={(prev, fd) => attempt(async () => { ...; return "Mensagem de sucesso"; })}`; `ActionButton action={() => attempt(...)}`. `attempt` e `formObject` em `@/lib/result`.
- As leituras directas às tabelas respeitam RLS (cada utilizador só vê o que pode). As escritas sensíveis são por RPC. Escrita directa permitida (RLS) em: branches, departments, work_locations (enviar `center_lat`/`center_lng`; `center` é calculado), attendance_stations (sem `static_token_hash`), work_schedules, schedule_rules, holidays, shift_assignments, employment_contracts, employees (UPDATE de colunas de ficha), employee_components (insert; update effective_to/note), payroll_components (insert/update), companies (UPDATE name, legal_name, nuit, email, phone, address, settings), subscription_plans (Super Admin), notifications (read_at), ai_conversations (próprias).
- `users` só expõe `id, email (=login), name, status, is_platform_admin, last_login_at, created_at`. `attendance_stations` não expõe `static_token_hash` — use `select("id,company_id,location_id,name,qr_mode,rotation_seconds,active,last_seen_at,created_at")`, nunca `select("*")` nesta tabela nem em `users`.
- Joins do PostgREST pelas chaves estrangeiras: ex. `sb().from("employees").select("id,full_name,departments(name)")`.
- Esquema: `supabase/01_esquema.sql`. Funções: `supabase/04_parte1.sql … 04_parte5.sql` (cabeçalhos `CREATE OR REPLACE FUNCTION ps_...`).
- Storage: bucket privado `justificacoes`, caminho `<company_id>/<request_id>/<uuid>-<nome>`; ler com `createSignedUrl`.
- Assistente: `sb().functions.invoke("assistente", { body: { companyId, messages: [{ role: "user" | "model", text }] } })` → `{ reply }` ou `{ error }`.

## Interface

- Reutilizar `src/components/ui/*`, `src/components/charts/*`, `src/components/maps/*`, `PageHeader`/`PageBody`. Mobile-first, pt-PT, sem emojis, frases em minúscula inicial ("Novo colaborador").
- Estados: mostrar `Skeleton` ao carregar, `Notice tone="danger"` em erro, `EmptyState` sem dados.
- Implementação antiga (servidor) para referência de UI e textos: `git show 2e4155a:<caminho>`.
