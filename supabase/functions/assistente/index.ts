// Horbit — Edge Function "assistente" (Supabase).
// Conversa com o Super Admin (scope "platform") ou com a gestão de uma empresa (scope "company").
// Os dados vêm de ps_ai_platform_context / ps_ai_context com o login do próprio utilizador
// (as regras de acesso aplicam-se). A chave do Gemini fica no segredo GEMINI_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS = [Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"];
const GEMINI = Deno.env.get("GEMINI_API_BASE") ?? "https://generativelanguage.googleapis.com/v1beta";

type Msg = { role: "user" | "model"; text: string };

const GUIDE_COMPANY = `Como funciona o Horbit (painel da empresa):
- Painel: quem está presente hoje, atrasos, faltas e gráficos dos últimos 30 dias.
- Colaboradores: criar colaborador (nome, código, horário, salário, utilizador e palavra-passe, papel). Na ficha: dados, histórico salarial, redefinir palavra-passe, desactivar.
- Papéis: responsável (owner), administrador, RH, financeiro, supervisor, colaborador.
- Locais e estações: criar o local com morada e raio (geofence); criar a estação (ecrã da recepção) que mostra um QR que muda a cada 30 segundos. Abrir a estação num tablet ou computador na entrada.
- Marcação: o colaborador abre o Horbit no telemóvel, Marcar ponto, lê o QR e o GPS confirma que está dentro do local. GPS fraco ou no limite fica em revisão (não é fraude).
- Assiduidade: lista diária; Revisão para decidir marcações duvidosas; Correcções para corrigir horas com motivo.
- Justificações: o colaborador pede com anexo (atestado); supervisor e/ou RH aprovam ou recusam com fundamento.
- Horários e feriados: horários semanais e feriados de Moçambique.
- Salários: 1) fechar a assiduidade do mês, 2) gerar o pré-processamento, 3) outra pessoa aprova (quem prepara não aprova), 4) emitir recibos em PDF, 5) registar pagamentos. Rubricas e regras: subsídios, descontos; regras legais (INSS, IRPS) só se aplicam depois de validadas por especialista.
- Relatórios: exportação em Excel. Auditoria: registo de todas as alterações. Definições: dados da empresa e políticas.`;

const GUIDE_PLATFORM = `Como funciona o Horbit (Super Admin):
- Visão geral: empresas, colaboradores activos, pedidos pendentes e actividade de marcações.
- Pedidos de acesso: a empresa envia em /registo/ só o nome, o email e o motivo. O Super Admin usa "Pedir dados por email" para pedir o nome do responsável e os dados da empresa; com a resposta usa "Criar conta" (cria a empresa e o acesso do responsável) e depois "Enviar por email" para mandar as credenciais. Também pode recusar com motivo.
- Empresas: criar empresa directamente, ver o responsável, redefinir a palavra-passe do responsável, suspender ou reactivar.
- Auditoria: todas as acções na plataforma.
- O Super Admin não vê salários das empresas. Cada empresa cria os acessos da própria equipa.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta o segredo GEMINI_API_KEY na Edge Function." }, 500);

  let body: { scope?: "company" | "platform"; companyId?: string; messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido." }, 400);
  }
  const platform = body.scope === "platform";
  const messages = (body.messages ?? []).filter((m) => m?.text?.trim()).slice(-16);
  if (!messages.length || (!platform && !body.companyId)) return json({ error: "Escreva uma mensagem." }, 400);
  if (messages[messages.length - 1].role !== "user") return json({ error: "A última mensagem deve ser sua." }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: context, error } = platform
    ? await supabase.rpc("ps_ai_platform_context")
    : await supabase.rpc("ps_ai_context", { p_company: body.companyId });
  if (error) return json({ error: error.message }, 403);

  const system = [
    "És o assistente do Horbit, um sistema de ponto, assiduidade e salários para empresas em Moçambique.",
    platform
      ? "Estás a conversar com o Super Admin da plataforma, que gere as empresas clientes."
      : "Estás a conversar com alguém da gestão de uma empresa (responsável, RH, financeiro ou supervisor).",
    "Conversa de forma natural e simpática em português de Portugal: cumprimenta, responde a perguntas de seguimento, pede esclarecimento quando a pergunta é ambígua e lembra-te do que já foi dito nesta conversa.",
    "Sê directo e curto. Texto simples; listas com hífen quando ajudar; **negrito** só para números ou nomes importantes.",
    "Para perguntas sobre dados, usa apenas o contexto JSON abaixo e diz de onde vem o número. Se o dado não estiver lá, diz que não o tens e indica a página do Horbit onde se vê.",
    "Para perguntas sobre como usar o Horbit, explica os passos com base no guia abaixo.",
    "Não tomas decisões nem executas acções: não aprovas faltas, não crias contas, não pagas, não aplicas sanções nem calculas taxas legais. Valores em MZN.",
    platform ? GUIDE_PLATFORM : GUIDE_COMPANY,
    `Contexto de dados (${new Date().toISOString().slice(0, 10)}):`,
    JSON.stringify(context),
  ].join("\n\n");

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 4000) }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
  };

  let lastError = "Assistente indisponível.";
  for (const model of MODELS) {
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const out = await res.json();
      const reply = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (reply) return json({ reply, model });
      lastError = "O assistente não devolveu resposta.";
      continue;
    }
    lastError =
      res.status === 429 || res.status === 503
        ? "O assistente está sobrecarregado. Tente daqui a pouco."
        : res.status === 400 || res.status === 403
          ? `O Gemini recusou o pedido (${res.status}). Confirme o segredo GEMINI_API_KEY.`
          : `Erro do Gemini (${res.status}).`;
    if (res.status !== 429 && res.status !== 503 && res.status !== 404) break;
  }
  return json({ error: lastError }, 502);
});
