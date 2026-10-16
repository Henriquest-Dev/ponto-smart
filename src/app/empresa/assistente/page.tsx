"use client";

import { AiBoundary } from "@/components/ai/ai-boundary";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { NoAccess } from "@/components/company/p2-shared";
import { useQueryParam } from "@/lib/sb/use-data";
import { useCompany } from "@/lib/sb/session";

const SUGGESTIONS = [
  "O que se passa agora na empresa?",
  "Quem chegou atrasado mais vezes nos últimos 30 dias?",
  "Cria um colaborador novo e dá-lhe acesso",
  "Faz-me a planilha da assiduidade deste mês",
];

export default function AssistantPage() {
  const { can, companyId, me } = useCompany();
  const voz = useQueryParam("voz");
  if (!can("ai.use")) return <NoAccess title="Assistente" />;
  return (
    <>
      <AiBoundary>
        <AssistantChat
          scope={{ kind: "company", companyId }}
          userId={me.id}
          userName={me.name}
          autoVoice={voz === "1"}
          suggestions={SUGGESTIONS}
          intro="Sou o Orbi, o seu gestor de RH. Pergunte, peça, anexe ficheiros ou faça uma chamada: eu preparo o trabalho e só aplico depois de confirmar."
        />
      </AiBoundary>
    </>
  );
}
