// Horbit — Edge Function "assistente" (Supabase).
// Responde a perguntas do RH/gestão com base num resumo dos dados da empresa.
// Os dados vêm de ps_ai_context com o login do próprio utilizador (as regras de
// acesso aplicam-se). A chave do Gemini fica no segredo GEMINI_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS = [Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"];

type Msg = { role: "user" | "model"; text: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta o segredo GEMINI_API_KEY na Edge Function." }, 500);

  let body: { companyId?: string; messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido." }, 400);
  }
  const messages = (body.messages ?? []).filter((m) => m?.text?.trim()).slice(-12);
  if (!body.companyId || !messages.length) return json({ error: "Indique a empresa e a pergunta." }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: context, error } = await supabase.rpc("ps_ai_context", { p_company: body.companyId });
  if (error) return json({ error: error.message }, 403);

  const system = [
    "És o assistente administrativo do Horbit, um sistema de ponto, assiduidade e salários em Moçambique.",
    "Responde em português de Portugal, de forma curta e objectiva, em texto simples (listas com hífen quando ajudar).",
    "Usa apenas os dados do contexto JSON abaixo. Se a informação não estiver lá, diz que não tens esse dado e indica onde o utilizador pode ver no painel.",
    "Não tomas decisões: não aprovas faltas, não aplicas sanções nem calculas taxas legais. Valores em MZN.",
    `Contexto (${new Date().toISOString().slice(0, 10)}):`,
    JSON.stringify(context),
  ].join("\n");

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 4000) }] })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  };

  let lastError = "Assistente indisponível.";
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
    lastError = res.status === 429 || res.status === 503 ? "O assistente está sobrecarregado. Tente daqui a pouco." : `Erro do Gemini (${res.status}).`;
    if (res.status !== 429 && res.status !== 503 && res.status !== 404) break;
  }
  return json({ error: lastError }, 502);
});
