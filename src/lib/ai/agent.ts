import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { HttpError } from "@/lib/errors";
import type { AppContext } from "@/lib/auth/context";
import type { AiMessage } from "@/lib/db/schema";
import { AI_TOOLS, runTool } from "./tools";

type Ctx = AppContext & { company: NonNullable<AppContext["company"]> };
export type Artifact = { executionId: string; kind: "notification_draft" | "document" };
type Result = { reply: string; artifacts: Artifact[] };

/** Rondas limitadas para responder dentro do tempo máximo das funções da Netlify. */
const MAX_TOOL_ROUNDS = 4;

export type AiProvider = "gemini" | "claude";

/** Gemini por defeito quando GEMINI_API_KEY existe; Claude como alternativa. */
export function aiProvider(): AiProvider | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

async function execute(ctx: Ctx, conversationId: string, name: string, input: unknown, artifacts: Artifact[]) {
  const outcome = await runTool(ctx, conversationId, name, input);
  if (outcome.executionId && name === "createNotificationDraft") artifacts.push({ executionId: outcome.executionId, kind: "notification_draft" });
  if (outcome.executionId && name === "generateDocument") artifacts.push({ executionId: outcome.executionId, kind: "document" });
  return outcome;
}

export async function runAgent(ctx: Ctx, conversationId: string, system: string, history: AiMessage[]): Promise<Result> {
  const provider = aiProvider();
  if (provider === "gemini") return runGemini(ctx, conversationId, system, history);
  if (provider === "claude") return runClaude(ctx, conversationId, system, history);
  throw new Error("Nenhum fornecedor de IA configurado.");
}

/* ------------------------------- Gemini -------------------------------- */

async function runGemini(ctx: Ctx, conversationId: string, system: string, history: AiMessage[]): Promise<Result> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  // Modelo rápido por defeito (cabe no tempo máximo das funções da Netlify) e
  // alternativas quando o serviço responde "alta procura" ou o modelo é retirado.
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-flash-latest"])];
  const generate = async (contents: Content[]): Promise<GenerateContentResponse> => {
    let last: unknown;
    for (const model of models) {
      try {
        return await ai.models.generateContent({ model, contents, config: { systemInstruction: system, tools, temperature: 0.2 } });
      } catch (err) {
        last = err;
        if (!(err instanceof ApiError) || ![404, 429, 500, 503].includes(err.status)) throw err;
        console.warn(`[ai] ${model} indisponível (${err.status}); a tentar o modelo seguinte.`);
      }
    }
    console.error("[ai] todos os modelos falharam", last);
    throw new HttpError(503, "O serviço de IA está sobrecarregado. Tente novamente dentro de instantes.", "ai_unavailable");
  };
  const tools = [
    {
      functionDeclarations: AI_TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })),
    },
  ];
  const contents: Content[] = history.slice(-20).map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const artifacts: Artifact[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await generate(contents);
    const calls = response.functionCalls ?? [];
    if (!calls.length || round === MAX_TOOL_ROUNDS) {
      const text = (response.text ?? "").trim();
      return { reply: text || "Não consegui concluir a análise. Reformule a pergunta.", artifacts };
    }
    // Mantém o conteúdo do modelo tal como veio (inclui assinaturas de raciocínio).
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const outcome = await execute(ctx, conversationId, name, call.args ?? {}, artifacts);
      let result: unknown = outcome.content;
      try {
        result = JSON.parse(outcome.content);
      } catch {
        // texto simples
      }
      parts.push({ functionResponse: { id: call.id, name, response: outcome.isError ? { error: result } : { result } } });
    }
    contents.push({ role: "user", parts });
  }
  return { reply: "", artifacts };
}

/* ------------------------------- Claude -------------------------------- */

async function runClaude(ctx: Ctx, conversationId: string, system: string, history: AiMessage[]): Promise<Result> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = history.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  const artifacts: Artifact[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      // Em caso de recusa por classificadores de segurança, o servidor tenta um modelo alternativo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools: AI_TOOLS,
      messages,
    });
    if (response.stop_reason === "refusal") return { reply: "Não posso ajudar com esse pedido.", artifacts };
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (response.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) {
      return { reply: text || "Não consegui concluir a análise. Reformule a pergunta.", artifacts };
    }
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")) {
      const outcome = await execute(ctx, conversationId, tu.name, tu.input, artifacts);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "", artifacts };
}
