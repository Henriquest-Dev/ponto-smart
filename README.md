# Horbit

Controlo de ponto por QR Code e localização, assiduidade, justificações, salários e recibos, para empresas em Moçambique (pt-PT, MZN, Africa/Maputo).

- **Site**: Next.js 15 + React 19 + TypeScript + Tailwind 4, exportado como site estático e publicado no **GitHub Pages**.
- **Servidor**: **Supabase** — Auth (login), PostgreSQL + PostGIS com regras de acesso por empresa (RLS), funções SQL para as operações sensíveis (marcar ponto, QR dinâmico, justificações, salários, criação de empresas e de acessos), Storage privado para anexos e uma Edge Function com o assistente Gemini.

## Pôr a funcionar (uma vez)

### 1. Supabase → SQL Editor

Executar por esta ordem (copiar o ficheiro todo, colar, *Run*):

1. `supabase/01_esquema.sql` — tabelas (só numa base vazia; se já correu, saltar).
2. `supabase/04_parte1.sql` a `supabase/04_parte18.sql`, por esta ordem — login, regras de acesso, funções, Storage, auditoria, assistente do Super Admin, QR Code fixo, marcação por link, assistente como gestor de RH, QR dinâmico e fixo em simultâneo, link de reserva diário, margem do geofence e assistente com acesso a toda a gestão de pessoas, memória do assistente, retirada da marcação por link e painel do Gerente (estoque e Oficina) e Oficina/Estoque personalizáveis (campos próprios, fotos, planilha do mês) e envio automático de emails por SMTP com uma só conta (Plataforma → Emails) , resumo mensal do Orbi por email e assistente do Super Admin com acções, lembretes por email e relógio automático (pg_cron). Podem ser executados de novo sempre que forem actualizados.
3. Criar o Super Admin (substituir utilizador, nome e palavra-passe):

```sql
DO $$ DECLARE v_id uuid; BEGIN
  INSERT INTO public.users (email, name, password_hash, is_platform_admin, status)
  VALUES ('o-meu-utilizador', 'O Meu Nome', 'supabase-auth', true, 'active')
  ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, status = 'active'
  RETURNING id INTO v_id;
  DELETE FROM auth.users WHERE email = public.ps_login_email('o-meu-utilizador') AND id <> v_id;
  PERFORM public.ps_auth_upsert(v_id, 'o-meu-utilizador', 'palavra-passe-segura');
END $$;
```

Opcional: em *Database → Extensions* activar **pg_cron** e voltar a correr o `04_parte5.sql` para o fecho diário automático (faltas pendentes às 22:30 UTC). Sem pg_cron, o painel da empresa fecha os dias em falta quando é aberto.

### 2. Supabase → Edge Functions (assistente)

1. *Edge Functions → Deploy a new function → Via Editor*, nome **Ponto-ai** (o nome que o site chama; pode ser outro com `NEXT_PUBLIC_AI_FUNCTION`), colar `supabase/functions/assistente/index.ts`, *Deploy*. Quando o ficheiro mudar, abrir a função, colar a versão nova e *Deploy* outra vez.
2. *Edge Functions → Secrets*: adicionar `GEMINI_API_KEY` com a chave do Google AI Studio.
   - Opcional, voz neural do assistente (Fish Audio pelo OpenRouter): `OPENROUTER_API_KEY` (chave em openrouter.ai/keys); opcionais `OPENROUTER_TTS_VOICE_F` e `OPENROUTER_TTS_VOICE_M` (ids das vozes feminina e masculina do fish.audio; já há vozes por omissão) e `OPENROUTER_TTS_MODEL` (por omissão `fish-audio/s2.1-pro-free:free`). Sem a chave, usa-se a voz do navegador.
   - Opcional, para o assistente enviar emails ao responsável: `RESEND_API_KEY` (conta em resend.com) e `EMAIL_FROM` (ex.: `Horbit <avisos@a-sua-empresa.co.mz>`, com o domínio verificado no Resend). Sem isto, o aviso chega como notificação no Horbit e há um botão para enviar pelo email do próprio utilizador.
3. O mesmo assistente serve o painel da empresa (*Assistente*) e o Super Admin (*Plataforma → Assistente*).

### 3. GitHub Pages

*Settings → Pages → Build and deployment → Source*: **GitHub Actions**. Cada push publica o site (`.github/workflows/pages.yml`) em `https://<utilizador>.github.io/ponto-smart/`.

O URL do projecto Supabase e a chave publicável estão em `src/lib/sb/client.ts` (podem ser substituídos por `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY`). A chave publicável é pública por natureza; a protecção dos dados está nas regras dos scripts `04_parte*.sql`.

## Quem cria cada acesso

| Conta | Quem cria | Onde |
|---|---|---|
| Super Admin | Quem gere a plataforma | SQL acima |
| Empresa + responsável | Super Admin | Plataforma → Pedidos de acesso: a empresa pede em `/registo/` (nome, email e motivo); o Super Admin pede os dados por email, cria a conta e envia as credenciais por email. Também em Plataforma → Empresas. |
| Colaboradores, supervisores, RH, financeiro | Responsável ou RH da empresa | Painel → Colaboradores → Novo colaborador / ficha |

Utilizadores sem `@` (ex.: `ana.macuacua`) são guardados no Supabase Auth como `ana.macuacua@pontosmart.app`; no login basta escrever `ana.macuacua`.

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # testes do motor salarial, regras de assiduidade e geofence
npm run typecheck
npm run build      # gera ./out (site estático)
```

Convenções do código cliente: `docs/FRONTEND.md`. Arquitectura: `docs/ARQUITECTURA.md`. Regras visuais: `docs/DESIGN.md`. Prompts das ilustrações: `docs/PROMPTS-ILUSTRACOES.md`.
