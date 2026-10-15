# Arquitectura do PontoSmart

## Visão geral

```mermaid
flowchart LR
  subgraph Clientes
    A[PWA Colaborador<br/>telemóvel] 
    B[Painel Empresa / RH / Financeiro<br/>desktop e telemóvel]
    C[Estação QR<br/>tablet / ecrã]
    D[Super Admin]
  end
  subgraph Netlify
    M[Middleware Edge<br/>cookie de sessão]
    N[Next.js<br/>Server Components, Server Actions,<br/>Route Handlers]
    F[Função agendada<br/>close-day]
    BL[(Netlify Blobs<br/>anexos e recibos)]
  end
  PG[(PostgreSQL + PostGIS)]
  AI[Claude API]
  A & B & C & D --> M --> N
  N --> PG
  N --> BL
  N --> AI
  F --> N
```

Camadas no código:

- `src/app` — rotas (páginas, server actions, API). Só orquestram: autenticação/permissões → validação (Zod) → domínio → `revalidatePath`.
- `src/lib/domain` — regras de negócio (marcação, assiduidade, justificações, salários, QR, geofence, auditoria, notificações). As partes puras (`geofence.ts`, `attendance-rules.ts`, `payroll/engine.ts`, `qr.ts`) não dependem da BD.
- `src/lib/auth` — sessões, palavras-passe, MFA, RBAC e contexto do pedido.
- `src/lib/db` — esquema Drizzle e ligação (preguiçosa).
- `src/lib/queries` — consultas de leitura reutilizadas pelas páginas (sempre com âmbito de empresa/equipa).
- `src/components` — UI (`ui/` primitivas estilo shadcn, `shell/` navegação, `charts/`, `maps/`).

## Árvore de pastas

```
ponto-smart/
├── drizzle/                     migrações SQL (extensões, esquema, triggers)
├── docs/ARQUITECTURA.md
├── netlify/functions/close-day.mts   tarefa diária
├── public/                      ícones PWA, service worker, página offline
├── scripts/                     migrate, seed, reset
├── src/
│   ├── app/
│   │   ├── (auth)/              login, MFA, acções de sessão
│   │   ├── app/                 portal do colaborador (mobile-first)
│   │   ├── empresa/             painel da empresa (RH, Financeiro, Supervisor)
│   │   ├── admin/               Super Admin
│   │   ├── estacao/[id]/        ecrã de QR dinâmico
│   │   ├── conta/seguranca/     palavra-passe e MFA
│   │   └── api/                 REST: auth, attendance, employees, absence-requests,
│   │                            payroll, payslips, reports, stations, ai, cron, health
│   ├── components/{ui,shell,charts,maps,attendance,pwa}
│   ├── lib/
│   │   ├── auth/                context, session, rbac, password, mfa
│   │   ├── db/                  schema.ts, index.ts
│   │   ├── domain/              attendance, attendance-rules, geofence, qr, absence,
│   │   │                        employees, audit, notifications, payroll/{engine,money,service,payslip-pdf}
│   │   ├── ai/tools.ts          ferramentas controladas do assistente
│   │   └── queries/             leituras com âmbito de empresa/equipa
│   └── middleware.ts
└── tests/                       unitários e integração
```

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

Garantias na base de dados (`drizzle/0002_integrity_guards.sql`): execuções aprovadas imutáveis, `audit_logs` apenas de acréscimo, verificações de datas, meses, dias da semana e raios.

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

A fonte de verdade é `src/lib/auth/rbac.ts`; o seed espelha-a em `roles`/`permissions`/`role_permissions`.

## API REST (resumo)

| Método | Endpoint | Finalidade |
|---|---|---|
| POST | `/api/auth/login` | Autenticação (cookie de sessão) |
| POST | `/api/auth/logout` | Terminar sessão |
| GET/POST | `/api/employees` | Listar / criar colaboradores |
| POST | `/api/attendance/clock` | Registar ponto |
| GET | `/api/attendance/me?month=YYYY-MM` | Histórico próprio |
| GET | `/api/stations/:id/qr` | Novo QR dinâmico (ecrã da estação) |
| POST | `/api/absence-requests` | Justificação (multipart com anexos) |
| PATCH | `/api/absence-requests/:id` | Decisão autorizada |
| GET | `/api/absence-documents/:id` | Anexo privado |
| POST | `/api/payroll/runs` | Pré-processamento |
| POST | `/api/payroll/runs/:id/approve` | Aprovação |
| GET | `/api/payslips/:id` | Recibo PDF autorizado |
| GET | `/api/reports/attendance`, `/employees`, `/payroll/:runId` | Exportações Excel |
| POST | `/api/ai/chat` | Assistente IA |
| GET/POST | `/api/ai/executions/:id` | Documento gerado / confirmação de rascunho |
| POST | `/api/cron/close-day` | Fecho diário (protegido por `CRON_SECRET`) |
| GET | `/api/health` | Disponibilidade |

## Assistente de IA

Fornecedor: Gemini (`GEMINI_API_KEY`, modelo rápido com alternativas automáticas em caso de sobrecarga) ou Claude (`ANTHROPIC_API_KEY`). Ciclo manual de chamadas de funções em `src/lib/ai/agent.ts`, limitado a 4 rondas.


Ferramentas: `getAttendanceSummary`, `findLateEmployees`, `getAbsenceRequests`, `preparePayrollReport`, `explainPayrollCalculation`, `createNotificationDraft`, `generateDocument`.

- Cada ferramenta corre com as permissões e o âmbito (empresa/equipa) do utilizador; sem SQL livre.
- `createNotificationDraft` cria apenas um rascunho (`approval_status = pending`); o envio exige confirmação explícita no ecrã.
- Não executa pagamentos, aprovações nem sanções. Todas as execuções ficam em `ai_tool_executions`.
