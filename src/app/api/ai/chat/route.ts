import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { aiConversations, type AiMessage } from "@/lib/db/schema";
import { aiProvider, runAgent } from "@/lib/ai/agent";
import { audit } from "@/lib/domain/audit";
import { localDate } from "@/lib/time";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


const body = z.object({ conversationId: z.string().uuid().nullable().optional(), message: z.string().trim().min(1).max(4000) });

function systemPrompt(companyName: string, today: string, role: string) {
  return [
    `És o assistente administrativo do PontoSmart para a empresa "${companyName}". Responde em português de Portugal, de forma objectiva e breve (no máximo cerca de 120 palavras, listas curtas quando ajudar).`,
    `Hoje é ${today} (fuso Africa/Maputo). Moeda: MZN. O utilizador tem o papel "${role}".`,
    "Usa as ferramentas para obter dados; nunca inventes números. Se uma ferramenta recusar por permissões, explica isso ao utilizador.",
    "Limites: não executas pagamentos, aprovações, sanções nem alterações de assiduidade. Notificações são apenas rascunhos que o utilizador confirma no ecrã.",
    "Não sugiras multas por atraso. Taxas de INSS/IRPS só existem se configuradas e validadas por especialista; não as inventes.",
    "Para dados pessoais, partilha apenas o necessário para a pergunta.",
  ].join("\n");
}

/** POST /api/ai/chat — assistente com ferramentas limitadas (ciclo manual de tool use). */
export const POST = withCompany(["ai.use"], async ({ req, ctx }) => {
  if (!aiProvider()) throw new HttpError(503, "Assistente indisponível: configure GEMINI_API_KEY.", "ai_disabled");
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
  
  const { reply, artifacts } = await runAgent(ctx, conversation.id, systemPrompt(ctx.company.name, localDate(new Date(), ctx.company.timezone), ctx.role ?? "staff"), history);

  const updated: AiMessage[] = [...history, { role: "assistant", content: reply, at: new Date().toISOString() }];
  await db.update(aiConversations).set({ messages: updated, updatedAt: new Date() }).where(eq(aiConversations.id, conversation.id));
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "ai.chat", entity: "ai_conversation", entityId: conversation.id, after: { tools: artifacts.length } });

  return NextResponse.json({ ok: true, conversationId: conversation.id, reply, artifacts });
});
