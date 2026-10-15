import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Notice } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/db/schema";
import { aiProvider } from "@/lib/ai/agent";
import { AssistantChat } from "./chat";

export const metadata: Metadata = { title: "Assistente" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireCompany("ai.use");
  const { c } = await searchParams;
  const conversations = await db
    .select({ id: aiConversations.id, title: aiConversations.title, messages: aiConversations.messages, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.companyId, ctx.company.id), eq(aiConversations.userId, ctx.user.id)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(30);
  const active = conversations.find((x) => x.id === c) ?? null;
  return (
    <>
      <PageHeader title="Assistente" description="Perguntas sobre assiduidade, justificações e salários, com ferramentas limitadas e auditadas." />
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        {!aiProvider() ? (
          <Notice tone="warning" title="Assistente desactivado">Defina a variável GEMINI_API_KEY (ou ANTHROPIC_API_KEY) no ambiente (Netlify → Site configuration → Environment variables).</Notice>
        ) : (
          <AssistantChat
            key={active?.id ?? "new"}
            conversations={conversations.map((x) => ({ id: x.id, title: x.title }))}
            conversationId={active?.id ?? null}
            initial={(active?.messages ?? []).map((m) => ({ role: m.role, content: m.content }))}
          />
        )}
      </div>
    </>
  );
}
