"use client";

import { AiBoundary } from "@/components/ai/ai-boundary";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { useQueryParam } from "@/lib/sb/use-data";
import { useSession } from "@/lib/sb/session";

const SUGGESTIONS = [
  "Olá! Faz-me um resumo da plataforma.",
  "Há pedidos de acesso por tratar?",
  "Que empresas não marcam ponto há mais de uma semana?",
  "Como crio uma empresa e o acesso do responsável?",
];

export default function AdminAssistantPage() {
  const { state } = useSession();
  const voz = useQueryParam("voz");
  if (state.status !== "ready") return null;
  return (
    <>
      <AiBoundary>
        <AssistantChat
          scope={{ kind: "platform" }}
          userId={state.me.id}
          userName={state.me.name}
          autoVoice={voz === "1"}
          suggestions={SUGGESTIONS}
          intro="Sou o Orbi. Conheço as empresas, os pedidos de acesso e a actividade da plataforma. Pergunte, anexe ficheiros ou faça uma chamada."
        />
      </AiBoundary>
    </>
  );
}
