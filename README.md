# PontoSmart

SaaS multiempresa de controlo de ponto por **QR Code dinâmico + geofence**, assiduidade, justificações e **processamento salarial com aprovação humana**, pensado para Moçambique (MZN, `Africa/Maputo`, português de Portugal).

Aplicação web progressiva (PWA) instalável em Android, iPhone e desktop, com interfaces **mobile-first** para o colaborador e painéis completos para Empresa, RH, Financeiro, Supervisor e Super Admin.

---

## Índice

1. [Stack e decisões técnicas](#stack-e-decisões-técnicas)
2. [Arranque rápido (local)](#arranque-rápido-local)
3. [Deploy na Netlify](#deploy-na-netlify)
4. [Contas de demonstração](#contas-de-demonstração)
5. [Painéis e jornadas](#painéis-e-jornadas)
6. [Fluxo de marcação de ponto](#fluxo-de-marcação-de-ponto)
7. [Processamento salarial](#processamento-salarial)
8. [Segurança](#segurança)
9. [Testes](#testes)
10. [Pressupostos e decisões em aberto](#pressupostos-e-decisões-em-aberto)
11. [Estado por sprint](#estado-por-sprint)

Arquitectura detalhada, modelo de dados (ER) e árvore de pastas: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Stack e decisões técnicas

| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | Server Components, Server Actions e Route Handlers num só projecto; suporte oficial na Netlify. |
| UI | **Tailwind CSS 4 + componentes estilo shadcn/ui** (Radix UI, CVA) | Design tokens em CSS (`src/app/globals.css`), componentes acessíveis e reutilizáveis em `src/components/ui`. |
| Base de dados | **PostgreSQL + PostGIS** | Geofence calculado no servidor (`ST_Covers`, `ST_Distance` em `geography`). |
| ORM / migrações | **Drizzle ORM + drizzle-kit** | SQL tipado, sem binários nativos (evita os erros típicos do Prisma em funções serverless). |
| Backend | **Next.js API (Route Handlers + Server Actions)**, modular em `src/lib/domain` | Ver justificação abaixo. |
| Autenticação | Sessões opacas em cookie `httpOnly` (hash SHA-256 na BD), **bcryptjs**, **TOTP (MFA)** | Sessões revogáveis; sem dependências nativas. |
| Ficheiros privados | **Netlify Blobs** (produção) / disco local (dev) | Anexos e recibos nunca são públicos; servidos por rotas autenticadas. |
| PDF / Excel | **pdf-lib** / **ExcelJS** | JavaScript puro, compatível com funções serverless. |
| Gráficos | **Recharts** | |
| Mapas | **Leaflet + OpenStreetMap** | Definição visual do perímetro de marcação. |
| QR | `qrcode` (geração) + `jsQR` / `BarcodeDetector` (leitura na câmara) | |
| IA | **Gemini (`@google/genai`)** com ferramentas limitadas; Claude como alternativa | Activo com `GEMINI_API_KEY` (ou `ANTHROPIC_API_KEY`). |
| Testes | **Vitest** (unitários + integração com PostgreSQL/PostGIS real) | |

**Next.js API vs NestJS.** Optou-se pelo backend dentro do Next.js porque: (1) o deploy alvo é a Netlify, onde o Next.js corre como funções serverless sem servidor permanente — um NestJS exigiria outro serviço alojado; (2) a lógica está isolada em módulos de domínio (`src/lib/domain/*`) independentes do transporte, testáveis e reutilizáveis — migrar para NestJS mais tarde implica apenas novos controladores; (3) uma só base de código e um só pipeline de deploy para o MVP.

---

## Arranque rápido (local)

Requisitos: Node 22, PostgreSQL 14+ com a extensão PostGIS.

```bash
npm install
cp .env.example .env            # ajuste DATABASE_URL e os segredos
npm run db:migrate              # cria extensões, tabelas, índices e triggers
npm run db:seed                 # dados fictícios de demonstração
npm run dev                     # http://localhost:3000
```

Comandos úteis:

| Comando | Descrição |
|---|---|
| `npm run build` | Build de produção (igual ao da Netlify) |
| `npm test` | Testes unitários + integração (`TEST_DATABASE_URL`) |
| `npm run lint` / `npm run typecheck` | Qualidade |
| `npm run db:generate` | Gera nova migração após alterar `src/lib/db/schema.ts` |
| `npm run db:reset` | Apaga e recria a base de dados local (bloqueado em produção) |

> A câmara e a localização só funcionam em **HTTPS** ou em `localhost`. Para testar no telemóvel em rede local, use um túnel HTTPS (ex.: `npx localtunnel --port 3000`) ou o deploy de pré-visualização da Netlify.

---

## Deploy na Netlify

O projecto foi preparado para evitar os erros comuns de deploy:

- **Sem acesso à BD durante o build** — todas as páginas são dinâmicas e a ligação é criada apenas no primeiro pedido.
- **Sem dependências nativas** (bcryptjs, pdf-lib, ExcelJS, postgres.js) — nada para compilar no ambiente da Netlify.
- **Middleware leve (Edge)** — só verifica a presença do cookie; nada de BD ou módulos Node no Edge.
- **Lint não bloqueia o build** (corre em `npm run lint`); o TypeScript é verificado no build e está limpo.
- **Node 22** fixado em `netlify.toml` e `.nvmrc`.
- **Runtime Next.js detectado automaticamente** — não adicione `@netlify/plugin-nextjs` manualmente.
- **Limite de ~6 MB por pedido** respeitado (anexos: 4 MB cada, 5 MB no total).

### 1. Base de dados (PostgreSQL com PostGIS)

Use **Neon** ou **Supabase** (ambos suportam PostGIS). Escolha a região mais próxima dos utilizadores.

- **Neon**: copie a *connection string* **pooled** (`...-pooler...neon.tech/...?sslmode=require`).
- **Supabase**: use a ligação *Transaction pooler* (porta `6543`).

A partir do seu computador, aplique as migrações e (opcionalmente) os dados de demonstração:

```bash
DATABASE_URL="postgres://…" npm run db:migrate
DATABASE_URL="postgres://…" npm run db:seed      # opcional (demonstração)
```

### 2. Site na Netlify

1. *Add new site → Import an existing project* e escolha este repositório. O `netlify.toml` já define `npm run build` e `.next`.
2. Em **Site configuration → Environment variables**, crie (âmbito *Builds* e *Functions*):

| Variável | Obrigatória | Valor |
|---|---|---|
| `DATABASE_URL` | sim | Ligação *pooled* do passo 1 |
| `SESSION_SECRET` | sim | `openssl rand -base64 48` |
| `QR_SIGNING_SECRET` | sim | `openssl rand -base64 48` (diferente do anterior) |
| `CRON_SECRET` | sim | `openssl rand -base64 32` |
| `GEMINI_API_KEY` | não | Activa o assistente de IA (Google AI Studio) |
| `GEMINI_MODEL` | não | Por defeito `gemini-flash-lite-latest` (rápido; cabe no tempo das funções). Alternativas automáticas se o Google estiver sobrecarregado |
| `ANTHROPIC_API_KEY` | não | Alternativa ao Gemini (Claude) |
| `DEMO_MODE` | não | `false` para esconder as contas de demonstração no login |

3. *Deploy*. Os ficheiros privados vão automaticamente para **Netlify Blobs** (nada a configurar).
4. A função agendada `netlify/functions/close-day.mts` corre diariamente às 02:15 UTC (04:15 em Maputo) e consolida o dia anterior (faltas pendentes e registos incompletos).

### 3. Depois do deploy

- Verifique `https://<site>/api/health` → `{"ok":true,"db":"up"}`.
- Entre como Super Admin, crie a empresa real e **altere as palavras-passe de demonstração** (ou não execute o seed em produção).
- Funções síncronas da Netlify têm limite de tempo (10 s por defeito, até 26 s mediante pedido). O assistente de IA usa esforço baixo e no máximo 4 rondas de ferramentas para caber nesse limite.

---

## Contas de demonstração

Palavra-passe de todas: **`PontoSmart2026`** (dados fictícios).

| Perfil | Email | Onde entra |
|---|---|---|
| Colaborador | `colaborador@mahotas.example` | `/app` (mobile-first) |
| Supervisor | `supervisor@mahotas.example` | `/empresa` (só a equipa de Operações e Armazém) |
| RH | `rh@mahotas.example` | `/empresa` — prepara salários |
| Financeiro | `financeiro@mahotas.example` | `/empresa` — aprova e regista pagamentos |
| Proprietário | `dono@mahotas.example` | `/empresa` — acesso total |
| Super Admin | `admin@pontosmart.co.mz` | `/admin` — sem acesso salarial |
| Outra empresa | `dono@beira.example` | Testar isolamento entre empresas |

O seed cria ~2 meses e meio de marcações, um mês de salários **aprovado com recibos e pagamentos**, o mês seguinte **à espera da aprovação do Financeiro** e o mês corrente com pendências por resolver.

---

## Como as contas são criadas

1. **Home pública** (`/`): apresenta o funcionamento, as funcionalidades, os **preços** (planos da base de dados) e um botão para pedir conta.
2. **Pedido de conta** (`/registo`): a empresa envia os dados e o plano pretendido. Nada é criado automaticamente.
3. **Super Admin** (`/admin/empresas`): vê os pedidos pendentes, aprova (escolhe plano e dias experimentais) e recebe as **credenciais do proprietário**, mostradas uma única vez. Também pode criar empresas directamente.
4. **Empresa** (`/empresa/colaboradores` e `/empresa/definicoes`): o proprietário cria as credenciais dos colaboradores, RH, financeiro e supervisores.

## Painéis e jornadas

| Painel | Rotas | Principais funções |
|---|---|---|
| **Colaborador** (mobile-first, navegação inferior) | `/app`, `/app/marcar`, `/app/historico`, `/app/justificacoes`, `/app/recibos`, `/app/perfil` | Marcar ponto (câmara + GPS), estado do dia com tempo trabalhado, histórico com anomalias, justificações com anexos e estado de aprovação, recibos PDF com confirmação de recepção, dispositivos de confiança |
| **Empresa / RH / Financeiro / Supervisor** (sidebar no desktop, navegação inferior + menu no telemóvel) | `/empresa/*` | Painel diário, colaboradores (ficha, contrato, salário histórico, rubricas, dispositivos), assiduidade (registos, revisão de marcações, correcções com histórico), justificações (supervisor → RH), salários (fecho, pré-processamento, aprovação, recibos, pagamentos), rubricas e regras versionadas, horários/turnos/feriados, locais com mapa de geofence e estações, relatórios Excel, assistente IA, auditoria, definições (políticas, utilizadores, papéis, filiais, departamentos) |
| **Estação de QR** (ecrã/quiosque) | `/estacao/[id]` | QR dinâmico que roda a cada 30 s, relógio, instruções, mantém o ecrã ligado |
| **Home pública** | `/`, `/registo` | Funcionamento, funcionalidades, preços, pedido de conta |
| **Super Admin** | `/admin/*` | Painel com gráficos (pontualidade/presença, utilização por empresa, receita), pedidos de conta, empresas (criar, aprovar, suspender, plano), planos, facturação SaaS, saúde do serviço |
| **Conta** | `/conta/seguranca` | Palavra-passe e MFA (TOTP) |

---

## Fluxo de marcação de ponto

`autenticação → leitura do QR → validação do token no servidor → localização com consentimento → perímetro e precisão (PostGIS) → dispositivo (política) → prevenção de duplicados → hora do servidor → resultado`

Implementação: `src/lib/domain/attendance.ts` (`clock`) e `POST /api/attendance/clock`.

| Regra | Implementação |
|---|---|
| P01 Apenas utilizadores activos | Sessão válida + ficha de colaborador activa + empresa não suspensa |
| P02 QR dinâmico assinado | Token HMAC-SHA256 compacto, expira em segundos, registado em `qr_challenges`; QR fixo apenas com política de menor garantia |
| P03 Hora do servidor | `occurred_at` definido no servidor; fuso por empresa |
| P04 Geofence com precisão | Raio ou polígono em `geography`; precisão acima do limite ou na fronteira → **inconclusivo → revisão** (nunca fraude automática) |
| P05 Dispositivo de confiança | Factor adicional (`off` / `warn` / `require`); numa PWA não identifica hardware de forma infalível |
| P06 Idempotência e duplicados | Chave de idempotência por pedido + janela anti-duplicados + *advisory lock* por colaborador |
| P07 Entradas, saídas, intervalos, turnos nocturnos | `work_date` herdado da entrada aberta; horários com fim < início atravessam a meia-noite |
| P08 Excepções sob revisão | Pedido de revisão pelo colaborador; validação/rejeição fundamentada por RH ou supervisor da equipa |

Não há rastreio contínuo: a localização é pedida apenas no momento da marcação e guardada arredondada (~1 m).

---

## Processamento salarial

`fechar assiduidade → resolver pendências → contratos e rubricas vigentes → motor determinístico → pré-processamento (versão N) → aprovação por outra pessoa → recibos PDF → registo de pagamentos`

- **Motor puro e versionado** (`src/lib/domain/payroll/engine.ts`): aritmética em cêntimos, hash SHA-256 dos dados de entrada guardado em cada execução; a aprovação recalcula e recusa se os dados mudaram.
- **Sem taxas legais embutidas**: INSS/IRPS (ou outras) só são aplicadas a partir de versões de regra **marcadas como validadas** por um especialista (nome e fonte registados). Sem validação, o motor avisa e não retém.
- **Sem multas por atraso**: faltas injustificadas **validadas por um responsável** geram apenas “ausência não remunerada”.
- **Separação de funções**: quem prepara não aprova; RH prepara, Financeiro aprova e regista pagamentos.
- **Imutabilidade na base de dados**: triggers impedem alterar/apagar itens e linhas de execuções aprovadas.
- **Pagamento ≠ recepção**: o registo de pagamento (Financeiro) é distinto da confirmação de recepção do recibo (colaborador).

---

## Segurança

- RBAC verificado em **todas** as páginas, server actions e rotas (`requireCompany`, `withCompany`).
- Isolamento multi-empresa: todas as consultas filtram por `company_id`; supervisores filtrados pelos departamentos que gerem. Testado em `tests/integration.test.ts`.
- MFA TOTP (segredo cifrado AES-256-GCM); política opcional para exigir MFA a perfis com privilégios.
- Rate limiting partilhado em PostgreSQL (login, MFA, marcação, IA).
- Protecção CSRF (verificação de `Origin`), cookies `httpOnly`/`secure`/`SameSite=Lax`, cabeçalhos de segurança (HSTS, `X-Frame-Options`, `Permissions-Policy`).
- Trilho de auditoria **apenas de acréscimo** (trigger) para login, marcações, decisões, correcções, salários, exportações e acessos a documentos.
- Ficheiros privados apenas por rotas autenticadas com verificação de permissão.
- O Super Admin não tem permissões salariais nem lê dados de salários das empresas.

---

## Testes

```bash
npm test
```

- **Unitários**: geofence, tokens de QR (assinatura, adulteração, expiração), regras de assiduidade (tolerância, intervalos, horas extra, turnos nocturnos), motor salarial (determinismo, arredondamentos, regras validadas vs não validadas), RBAC.
- **Integração** (PostgreSQL + PostGIS reais, `TEST_DATABASE_URL`): marcação aceite/rejeitada/em revisão, idempotência, duplicados, **QR de outra empresa recusado**, decisões cruzadas entre empresas recusadas, justificação com histórico, bloqueio do fecho com pendências, separação de funções, imutabilidade e auditoria apenas de acréscimo.

Resultado actual: **45 testes a passar**. Fluxos end-to-end (câmara simulada + GPS) foram verificados com Playwright durante o desenvolvimento.

---

## Pressupostos e decisões em aberto

Defaults seguros usados no protótipo — **confirmar antes de produção**:

| Tema | Pressuposto actual |
|---|---|
| QR | Dinâmico em ecrã (rotação 30 s, validade 45 s); QR fixo disponível mas assinalado como menor garantia |
| Geofence | Raio 60 m (sede) / 120 m (armazém); precisão máxima aceite 80–100 m |
| Dispositivo | Política `warn` (assinala, não bloqueia) |
| Aprovações | Supervisor → RH (configurável para “apenas RH”) |
| Divisor diário | 30 dias (configurável) |
| Horas extra | Multiplicador 1,5× **de demonstração** (rubrica configurável) |
| INSS / IRPS | **Não configurados** — requerem tabelas vigentes validadas |
| Feriados | Feriados nacionais recorrentes — confirmar calendário oficial anual |
| Planos SaaS | Preços fictícios |
| Recibo | Modelo simples — validar com contabilista |

Validação jurídica, fiscal e laboral moçambicana é necessária antes de uso real dos cálculos salariais.

---

## Estado por sprint

| Sprint | Âmbito | Estado |
|---|---|---|
| 1 | Fundação: empresas, autenticação, MFA, RBAC, colaboradores | Implementado e testado |
| 2 | Horários, QR dinâmico, geofence, marcações, histórico | Implementado e testado (incl. E2E) |
| 3 | Justificações, aprovações, notificações (in-app), relatórios | Implementado e testado |
| 4 | Motor salarial, rubricas, pré-processamento, recibos, pagamentos | Implementado e testado (regras legais por validar) |
| 5 | Testes reais em campo, validação legal, piloto | **Por fazer** — requer telemóveis reais e cliente-piloto |
| 6 | Assistente IA e comercialização SaaS | Implementado (IA requer chave); cobrança automática por integrar |

Ainda não implementado (próximos passos): notificações por email/push, RLS no PostgreSQL como defesa adicional ao isolamento aplicacional, acesso de suporte com autorização do cliente, integração de pagamentos (M-Pesa/e-Mola/bancos), edição de polígonos no mapa (o esquema já suporta `geom`).
