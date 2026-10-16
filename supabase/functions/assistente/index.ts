// Horbit — Edge Function do assistente (Supabase; publicada como "Ponto-ai").
// Super Admin (scope "platform"): conversa sobre a plataforma.
// Empresa (scope "company"): gestor de RH — conversa, análise automática (mode "insights") e propostas de acções
// que o utilizador confirma no ecrã (a função nunca altera dados: só propõe).
// Os dados vêm de ps_ai_platform_context / ps_ai_context com o login do próprio utilizador (as regras de acesso aplicam-se).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS = [Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite"];
const GEMINI = Deno.env.get("GEMINI_API_BASE") ?? "https://generativelanguage.googleapis.com/v1beta";

type Msg = { role: "user" | "model"; text: string };
type Action = { type: string; label: string; args: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
type Ctx = any;

const GUIDE_COMPANY = `Como funciona o Horbit (painel da empresa):
- Painel: quem está presente hoje, atrasos, faltas e gráficos dos últimos 30 dias.
- QR Code (menu QR Code): código fixo da empresa, impresso na entrada, com horário de validade; o colaborador lê com a câmara e o ponto fica marcado (entrada e depois saída). Marcação por link: em dias especiais, a empresa define dia e horas e aparece um botão "Marcar ponto" no painel dos colaboradores.
- Colaboradores: criar colaborador (nome, código, horário, salário, utilizador e palavra-passe, papel). Na ficha: dados, histórico salarial, redefinir palavra-passe, desactivar, relatório do mês.
- Papéis: responsável (owner), administrador, RH, financeiro, supervisor, colaborador.
- Locais e estações: local com morada e raio (geofence) e estações (ecrã da recepção).
- Assiduidade: lista diária; Revisão para decidir marcações duvidosas; Correcções para corrigir horas com motivo.
- Justificações: o colaborador pede com anexo; supervisor e/ou RH aprovam ou recusam com fundamento.
- Relatórios: relatório por colaborador (mês dia a dia) e exportação em Excel.
- Salários: fechar a assiduidade, gerar o pré-processamento, outra pessoa aprova, emitir recibos, registar pagamentos.
- Auditoria: quem fez o quê e quando.`;

const GUIDE_PLATFORM = `Como funciona o Horbit (Super Admin):
- Visão geral: empresas, colaboradores activos, pedidos pendentes e actividade de marcações.
- Pedidos de acesso (menu Plataforma → Pedidos de acesso): as empresas pedem acesso na página pública "Pedir acesso" com só o nome, o email e o motivo. No menu Pedidos de acesso, o Super Admin usa "Pedir dados por email" para pedir o nome do responsável e os dados da empresa; com a resposta usa "Criar conta" (cria a empresa e o acesso do responsável) e depois "Enviar por email" para mandar as credenciais. Também pode recusar com motivo.
- Empresas: criar empresa directamente, ver o responsável, redefinir a palavra-passe do responsável, suspender ou reactivar.
- Auditoria: todas as acções na plataforma.
- O Super Admin não vê salários das empresas. Cada empresa cria os acessos da própria equipa.`;

/** Acções que o assistente da empresa pode propor (o utilizador confirma no ecrã). */
const TOOLS = [
  {
    name: "decidir_justificacao",
    description: "Propor aprovar ou recusar uma justificação de falta pendente. Usar o id de justificacoesPendentes.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        decisao: { type: "STRING", enum: ["aprovar", "recusar"] },
        fundamento: { type: "STRING", description: "Fundamento curto da decisão, em português." },
      },
      required: ["id", "decisao", "fundamento"],
    },
  },
  {
    name: "rever_marcacao",
    description: "Propor aceitar ou rejeitar uma marcação em revisão. Usar o id de marcacoesEmRevisao.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        decisao: { type: "STRING", enum: ["aceitar", "rejeitar"] },
        fundamento: { type: "STRING" },
      },
      required: ["id", "decisao", "fundamento"],
    },
  },
  {
    name: "criar_marcacao_por_link",
    description: "Propor uma marcação por link para um dia especial (o botão aparece aos colaboradores nesse dia e horas).",
    parameters: {
      type: "OBJECT",
      properties: {
        dia: { type: "STRING", description: "Data AAAA-MM-DD" },
        das: { type: "STRING", description: "Hora HH:MM" },
        as: { type: "STRING", description: "Hora HH:MM" },
        motivo: { type: "STRING" },
      },
      required: ["dia", "das", "as"],
    },
  },
  {
    name: "definir_horario_qr",
    description: "Propor o horário em que o QR Code fixo aceita marcações. Sem das/as = qualquer hora.",
    parameters: { type: "OBJECT", properties: { das: { type: "STRING" }, as: { type: "STRING" } } },
  },
  {
    name: "abrir_relatorio",
    description: "Propor abrir o relatório do mês de um colaborador. Usar o id de equipaEsteMes.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
];

const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);
const isTime = (t: unknown) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);

/** Valida a chamada do modelo contra o contexto e escreve o texto do botão. Devolve null se não fizer sentido. */
function toAction(name: string, args: Record<string, unknown>, ctx: Ctx): Action | null {
  if (name === "decidir_justificacao") {
    const j = (ctx?.justificacoesPendentes ?? []).find((x: Ctx) => x.id === args.id);
    if (!j || !["aprovar", "recusar"].includes(String(args.decisao))) return null;
    const fundamento = String(args.fundamento ?? "").trim() || "Decisão proposta pelo assistente.";
    return {
      type: name,
      label: `${args.decisao === "aprovar" ? "Aprovar" : "Recusar"} a justificação de ${j.nome} (${fmtDate(j.de)} a ${fmtDate(j.ate)}): ${fundamento}`,
      args: { id: j.id, decisao: args.decisao, fundamento },
    };
  }
  if (name === "rever_marcacao") {
    const m = (ctx?.marcacoesEmRevisao ?? []).find((x: Ctx) => x.id === args.id);
    if (!m || !["aceitar", "rejeitar"].includes(String(args.decisao))) return null;
    const fundamento = String(args.fundamento ?? "").trim() || "Decisão proposta pelo assistente.";
    return {
      type: name,
      label: `${args.decisao === "aceitar" ? "Aceitar" : "Rejeitar"} a marcação de ${m.nome} (${m.quando}): ${fundamento}`,
      args: { id: m.id, decisao: args.decisao, fundamento },
    };
  }
  if (name === "criar_marcacao_por_link") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.dia)) || !isTime(args.das) || !isTime(args.as)) return null;
    const motivo = String(args.motivo ?? "").trim();
    return {
      type: name,
      label: `Criar marcação por link em ${fmtDate(String(args.dia))}, das ${args.das} às ${args.as}${motivo ? ` (${motivo})` : ""}`,
      args: { dia: args.dia, das: args.das, as: args.as, motivo },
    };
  }
  if (name === "definir_horario_qr") {
    const sem = !args.das && !args.as;
    if (!sem && (!isTime(args.das) || !isTime(args.as))) return null;
    return {
      type: name,
      label: sem ? "O QR Code passa a aceitar marcações a qualquer hora" : `O QR Code passa a aceitar marcações das ${args.das} às ${args.as}`,
      args: sem ? {} : { das: args.das, as: args.as },
    };
  }
  if (name === "abrir_relatorio") {
    const e = (ctx?.equipaEsteMes ?? []).find((x: Ctx) => x.id === args.id);
    if (!e) return null;
    return { type: name, label: `Abrir o relatório do mês de ${e.nome}`, args: { id: e.id } };
  }
  return null;
}

/** Segundo pedido (só na análise): obriga a propor uma decisão por cada pendente, como botões. */
async function proposeDecisions(key: string, model: string, payload: Record<string, unknown>, analysis: string, ctx: Ctx): Promise<Action[]> {
  const contents = [
    ...(payload.contents as unknown[]),
    { role: "model", parts: [{ text: analysis }] },
    { role: "user", parts: [{ text: "Agora propõe a decisão para cada justificação pendente e cada marcação em revisão, chamando as funções (uma chamada por pendente), com fundamento curto." }] },
  ];
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...payload,
      contents,
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["decidir_justificacao", "rever_marcacao"] } },
    }),
  });
  if (!res.ok) return [];
  const out = await res.json();
  const parts: { functionCall?: { name: string; args?: Record<string, unknown> } }[] = out?.candidates?.[0]?.content?.parts ?? [];
  const seen = new Set<string>();
  return parts
    .filter((p) => p.functionCall)
    .map((p) => toAction(p.functionCall!.name, p.functionCall!.args ?? {}, ctx))
    .filter((a): a is Action => !!a && !seen.has(String(a.args.id)) && !!seen.add(String(a.args.id)))
    .slice(0, 6);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta a chave do Gemini (segredo GEMINI_API_KEY) na Edge Function." }, 500);

  let body: { scope?: "company" | "platform"; companyId?: string; messages?: Msg[]; mode?: "chat" | "insights" };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido." }, 400);
  }
  const platform = body.scope === "platform";
  const insights = !platform && body.mode === "insights";
  let messages = (body.messages ?? []).filter((m) => m?.text?.trim()).slice(-16);
  if (insights) {
    messages = [
      {
        role: "user",
        text:
          "Faz agora a tua ronda de gestor de RH, sem eu pedir nada em concreto. Em 3 a 6 pontos curtos (lista com hífen), diz o que precisa de atenção hoje: " +
          "quem falta ou chegou atrasado, padrões de atrasos no mês, justificações e marcações por decidir, horas extra fora do normal, alterações recentes na auditoria que mereçam atenção. " +
          "Se nada precisar de atenção, diz isso numa frase. Depois propõe as acções que fazem sentido usando as funções disponíveis (por exemplo decidir justificações, rever marcações). Não inventes dados.",
      },
    ];
  }
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
      : "És o gestor de recursos humanos digital desta empresa: acompanhas a assiduidade de cada pessoa, os atrasos, as faltas, as justificações, as marcações em revisão, os salários e a auditoria, e propões acções concretas. Estás a falar com alguém da gestão (responsável, RH, financeiro ou supervisor).",
    "Conversa de forma natural e simpática em português de Portugal: cumprimenta, responde a perguntas de seguimento, pede esclarecimento quando a pergunta é ambígua e lembra-te do que já foi dito nesta conversa.",
    "Sê directo e curto. Texto simples; listas com hífen quando ajudar; **negrito** só para números ou nomes importantes. Datas como 15/10 e horas como 07:30.",
    "Para perguntas sobre dados, usa apenas o contexto JSON abaixo. Se o dado não estiver lá, diz que não o tens e indica a página do Horbit onde se vê.",
    platform
      ? "No contexto: marcacoesPorDia = últimos 14 dias."
      : "No contexto: hojeDetalhe = hoje (estado de cada pessoa); resumo e os números por departamento = últimos 30 dias; equipaEsteMes = mês corrente por pessoa; atrasos30dias = últimos 30 dias. Não confundas períodos: só digas \"hoje\" para dados de hojeDetalhe.",
    "Nunca mostres nomes técnicos do contexto (chaves do JSON, ids, nomes de funções, códigos de acções da auditoria como employees.insert); descreve-os em português corrente e fala pelos nomes das páginas e menus do Horbit.",
    "Para perguntas sobre como usar o Horbit, explica os passos com base no guia abaixo.",
    platform
      ? "Não executas acções: não crias contas, não aprovas pedidos nem alteras empresas."
      : "Tens funções para propor acções: decidir_justificacao, rever_marcacao, criar_marcacao_por_link, definir_horario_qr e abrir_relatorio. Sempre que propões ou o utilizador pede uma destas acções, CHAMA a função na mesma resposta (uma chamada por acção), com os ids do contexto: cada chamada aparece ao utilizador como um botão Confirmar. Não perguntes \"quer que avance?\" nem descrevas a acção só em texto: o botão já é a confirmação. No texto diz em uma frase o que propuseste. Nunca digas que a acção já está feita. Valores em MZN; não calculas taxas legais.",
    platform ? GUIDE_PLATFORM : GUIDE_COMPANY,
    `Contexto de dados (${new Date().toISOString().slice(0, 10)}):`,
    JSON.stringify(context),
  ].join("\n\n");

  const payload: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 4000) }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
  };
  if (!platform) {
    payload.tools = [{ functionDeclarations: TOOLS }];
    payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  let lastError = "Assistente indisponível.";
  for (const model of MODELS) {
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const out = await res.json();
      const parts: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] = out?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("").trim();
      const actions = parts
        .filter((p) => p.functionCall)
        .map((p) => toAction(p.functionCall!.name, p.functionCall!.args ?? {}, context))
        .filter((a): a is Action => !!a)
        .slice(0, 6);
      // Na análise automática, se há pendentes e o modelo não propôs botões, pede só as propostas de decisão.
      if (insights && !actions.length && text && (context?.justificacoesPendentes?.length || context?.marcacoesEmRevisao?.length)) {
        actions.push(...(await proposeDecisions(key, model, payload, text, context)));
      }
      if (text || actions.length) {
        return json({ reply: text || "Proponho o seguinte. Confirme o que quer fazer:", actions, model });
      }
      lastError = "O assistente não devolveu resposta.";
      continue;
    }
    lastError =
      res.status === 429 || res.status === 503
        ? "O assistente está sobrecarregado. Tente daqui a pouco."
        : res.status === 400 || res.status === 403
          ? `O Gemini recusou o pedido (${res.status}). Confirme a chave do Gemini.`
          : `Erro do Gemini (${res.status}).`;
    if (res.status !== 429 && res.status !== 503 && res.status !== 404) break;
  }
  return json({ error: lastError }, 502);
});
