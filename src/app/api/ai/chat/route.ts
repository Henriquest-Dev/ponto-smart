import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { aiConversations, type AiMessage } from "@/lib/db/schema";
import { AI_TOOLS, runTool } from "@/lib/ai/tools";
import { audit } from "@/lib/domain/audit";
import { env } from "@/lib/env";
import { localDate } from "@/lib/time";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-5-5";
// Rondas e esforço limitados para responder dentro do tempo máximo das funções da Netlify.
const MAX_TOOL_ROUNDS = 4;

const body = z.object({ conversationId: z.string().uuid().nullable().optional(), message: z.string().trim().min(1).max(4000) });

function systemPrompt(companyName: string, today: string, role: string) {
  return [
    `És o assistente administrativo do PontoSmart para a empresa "${companyName}". Responde em português de Portugal, de forma objectiva.`,
    `Hoje é ${today} (fuso Africa/Maputo). Moeda: MZN. O utilizador tem o papel "${role}".`,
    "Usa as ferramentas para obter dados; nunca inventes números. Se uma ferramenta recusar por permissões, explica isso ao utilizador.",
    "Limites: não executas pagamentos, aprovações, sanções nem alterações de assiduidade. Notificações são apenas rascunhos que o utilizador confirma no ecrã.",
    "Não sugiras multas por atraso. Taxas de INSS/IRPS só existem se configuradas e validadas por especialista; não as inventes.",
    "Para dados pessoais, partilha apenas o necessário para a pergunta.",
  ].join("\n");
}

/** POST /api/ai/chat — assistente com ferramentas limitadas (ciclo manual de tool use). */
export const POST = withCompany(["ai.use"], async ({ req, ctx }) => {
  if (!env.anthropicKey()) throw new HttpError(503, "Assistente indisponível: configure ANTHROPIC_API_KEY.", "ai_disabled");
  await rateLimit(`ai:${ctx.user.id}`, 20, 300);
  const input = body.parse(await req.json());

  let conversation = input.conversationId
    ? (
        await db
          .select()
          .from(aiConversations)
          .where(and(eq(aiConversations.id, input.conversationId), eq(aiConversations.companyId, ctx.company.id), eq(aiConversations.userId, ctx.user.id)))
          .limit(1)
      )[0]
    : undefined;
  if (input.conversationId && !conversation) throw new HttpError(404, "Conversa não encontrada.");
  if (!conversation) {
    [conversation] = await db
      .insert(aiConversations)
      .values({ companyId: ctx.company.id, userId: ctx.user.id, title: input.message.slice(0, 80), messages: [] })
      .returning();
  }

  const history: AiMessage[] = [...conversation.messages, { role: "user", content: input.message, at: new Date().toISOString() }];
  const messages: Anthropic.MessageParam[] = history.slice(-20).map((m) => ({ role: m.role, content: m.content }));

  const client = new Anthropic({ apiKey: env.anthropicKey() });
  const artifacts: { executionId: string; kind: "notification_draft" | "document" }[] = [];
  let reply = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      // Em caso de recusa por classificadores de segurança, o servidor tenta um modelo alternativo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(ctx.company.name, localDate(new Date(), ctx.company.timezone), ctx.role ?? "staff"),
      tools: AI_TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      reply = "Não posso ajudar com esse pedido.";
      break;
    }
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (response.stop_reason !== "tool_use") {
      reply = text || "(sem resposta)";
      break;
    }
    if (round === MAX_TOOL_ROUNDS) {
      reply = text || "Não consegui concluir a análise com o número de passos permitido. Reformule a pergunta.";
      break;
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const outcome = await runTool(ctx, conversation.id, tu.name, tu.input);
      if (outcome.executionId && tu.name === "createNotificationDraft") artifacts.push({ executionId: outcome.executionId, kind: "notification_draft" });
      if (outcome.executionId && tu.name === "generateDocument") artifacts.push({ executionId: outcome.executionId, kind: "document" });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }

  const updated: AiMessage[] = [...history, { role: "assistant", content: reply, at: new Date().toISOString() }];
  await db.update(aiConversations).set({ messages: updated, updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "ai.chat", entity: "ai_conversation", entityId: conversation.id, after: { tools: artifacts.length } });

  return NextResponse.json({ ok: true, conversationId: conversation.id, reply, artifacts });
});
