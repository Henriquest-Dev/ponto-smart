"use client";

import { AssistantChat } from "@/components/ai/assistant-chat";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/sb/session";

const SUGGESTIONS = [
  "Olá! Faz-me um resumo da plataforma.",
  "Há pedidos de acesso por tratar?",
  "Que empresas não marcam ponto há mais de uma semana?",
  "Como crio uma empresa e o acesso do responsável?",
];

export default function AdminAssistantPage() {
  const { state } = useSession();
  if (state.status !== "ready") return null;
  return (
    <>
      <PageHeader title="Assistente" description="Converse sobre as empresas, os pedidos de acesso e a actividade da plataforma." />
      <AssistantChat
        scope={{ kind: "platform" }}
        userId={state.me.id}
        suggestions={SUGGESTIONS}
        intro="Uso o resumo da plataforma: empresas, pedidos de acesso, actividade e auditoria. Não vejo salários das empresas e não executo acções."
      />
    </>
  );
}
