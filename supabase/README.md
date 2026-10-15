# Base de dados no Supabase

Executar no **SQL Editor** (Dashboard → SQL Editor → New query), por esta ordem, esperando por *Success* em cada um:

| Ficheiro | O que faz |
|---|---|
| `01_esquema.sql` | Tabelas, índices, integridade e dados de referência (papéis, permissões, planos). Só numa base vazia. |
| `04_parte1.sql` | Contas (Supabase Auth ↔ `public.users`), funções de contexto, auditoria automática. |
| `04_parte2.sql` | Regras de acesso (RLS) por empresa e papel, sessão (`ps_me`), pedido de conta público. |
| `04_parte3.sql` | Super Admin (criar empresas), colaboradores e acessos, consolidação da assiduidade. |
| `04_parte4.sql` | QR dinâmico, marcação de ponto com geofence, dispositivos, justificações. |
| `04_parte5.sql` | Salários, painel, contexto do assistente, permissões das funções, Storage, fecho diário. |

As partes 1–5 podem ser executadas de novo (por ordem) quando forem actualizadas.

Depois, criar o Super Admin com o bloco SQL do `README.md` da raiz.

`functions/assistente/index.ts` é a Edge Function do assistente (Edge Functions → Deploy → Via Editor; segredo `GEMINI_API_KEY`).
