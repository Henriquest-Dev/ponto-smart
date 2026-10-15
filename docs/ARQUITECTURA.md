# Arquitectura do PontoSmart

## Visão geral

```mermaid
flowchart LR
  subgraph Navegador["Site estático (GitHub Pages)"]
    A[PWA Colaborador]
    B[Painel Empresa]
    C[Estação QR]
    D[Super Admin]
  end
  subgraph Supabase
    AU[Auth<br/>login, MFA]
    PR[API REST<br/>PostgREST]
    PG[(PostgreSQL + PostGIS<br/>RLS + funções ps_*)]
    ST[(Storage<br/>justificacoes)]
    EF[Edge Function<br/>assistente]
    CR[pg_cron<br/>fecho diário]
  end
  GM[Gemini]
  A & B & C & D --> AU
  A & B & C & D --> PR --> PG
  A --> ST
  B --> EF --> PR
  EF --> GM
  CR --> PG
```

- `src/app` — páginas cliente (export estático, sem servidor próprio).
- `src/lib/sb` — cliente Supabase, sessão (`ps_me`), carregamento de dados.
- `src/lib/domain` — regras puras no navegador: geofence, regras de assiduidade, motor salarial (o resultado é gravado por `ps_payroll_save_run` e a aprovação confirma o hash dos dados).
- `supabase/04_parte1.sql … 04_parte5.sql` — fonte de verdade das permissões (RLS) e das operações sensíveis (`ps_clock`, `ps_station_qr`, `ps_submit_absence`, `ps_decide_absence`, `ps_create_employee`, `ps_set_access`, `ps_admin_create_company`, `ps_payroll_*`…).

## Modelo de dados

Todas as tabelas de cliente têm `company_id`; chaves UUID; dinheiro em `NUMERIC(14,2)`; instantes em `timestamptz` (UTC).

```mermaid
erDiagram
  companies ||--o{ branches : tem
  companies ||--o{ departments : tem
  companies ||--o{ memberships : tem
  users ||--o{ memberships : pertence
  roles ||--o{ memberships : define
  roles ||--o{ role_permissions : ""
  permissions ||--o{ role_permissions : ""
  companies ||--o{ employees : emprega
  users |o--o| employees : "conta de acesso"
  departments ||--o{ employees : agrupa
  employees ||--o{ employment_contracts : ""
  employees ||--o{ salary_agreements : "salário histórico"
  work_schedules ||--o{ schedule_rules : "dia da semana"
  employees ||--o{ shift_assignments : ""
  work_schedules ||--o{ shift_assignments : ""
  companies ||--o{ holidays : ""
  companies ||--o{ work_locations : "geofence (PostGIS)"
  work_locations ||--o{ attendance_stations : ""
  attendance_stations ||--o{ qr_challenges : "QR dinâmico"
  employees ||--o{ trusted_devices : ""
  employees ||--o{ attendance_events : marca
  attendance_events ||--|| attendance_validations : "QR, GPS, dispositivo"
  employees ||--o{ attendance_daily : "consolidação diária"
  employees ||--o{ attendance_adjustments : "correcções com versão anterior"
  employees ||--o{ absence_requests : justifica
  absence_requests ||--o{ absence_documents : anexos
  absence_requests ||--o{ approval_steps : "supervisor → RH"
  companies ||--o{ payroll_periods : ""
  payroll_periods ||--o{ payroll_runs : "versões"
  payroll_runs ||--o{ payroll_items : "por colaborador"
  payroll_items ||--o{ payroll_lines : rubricas
  payroll_rule_versions ||--o{ payroll_lines : "regra aplicada"
  companies ||--o{ payroll_components : catálogo
  employees ||--o{ employee_components : "subsídios e descontos"
  payroll_items ||--o| payslips : recibo
  payslips ||--o| payslip_acknowledgements : "recepção"
  payroll_items ||--o{ salary_payments : "pagamento"
  companies ||--o{ audit_logs : ""
  users ||--o{ notifications : ""
  users ||--o{ ai_conversations : ""
  ai_conversations ||--o{ ai_tool_executions : ""
  subscription_plans ||--o{ subscriptions : ""
  companies ||--o{ subscriptions : ""
  subscriptions ||--o{ billing_invoices : ""
  subscription_plans ||--o{ company_requests : "plano pedido"
  company_requests |o--o| companies : "aprovado → empresa"
```

Tabelas auxiliares: `sessions` (sessões revogáveis), `rate_limits` (contadores partilhados).

Garantias na base de dados (`01_esquema.sql`): execuções aprovadas imutáveis, `audit_logs` apenas de acréscimo, verificações de datas, meses, dias da semana e raios.

## Contextos de autorização

| Papel | Âmbito |
|---|---|
| `super_admin` | Plataforma (empresas, planos, facturação, saúde). Sem permissões de empresa. |
| `owner` | Tudo na empresa. |
| `admin` | Operação da empresa; não aprova salários nem regista pagamentos; não vê salários. |
| `hr` | Colaboradores, assiduidade, justificações, preparação salarial, emissão de recibos. |
| `finance` | Consulta salarial, aprovação, recibos, pagamentos. |
| `supervisor` | Apenas departamentos que gere: assiduidade, revisão e justificações da equipa. |
| `employee` | Apenas os próprios dados. |

As permissões estão nas tabelas `roles`/`permissions`/`role_permissions` e são aplicadas pelas regras RLS e funções do `04_parte1.sql … 04_parte5.sql`.

## Assistente de IA

Edge Function `assistente` (Deno). Recebe a pergunta, obtém um resumo dos dados com `ps_ai_context` usando o login do próprio utilizador (as regras de acesso aplicam-se) e pergunta ao Gemini (`GEMINI_API_KEY`, modelo rápido com alternativas em caso de sobrecarga). Não aprova, não paga, não sanciona.
