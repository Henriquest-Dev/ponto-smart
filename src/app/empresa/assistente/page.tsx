"use client";

import { AiBoundary } from "@/components/ai/ai-boundary";
import { AssistantChat } from "@/components/ai/assistant-chat";
import { NoAccess } from "@/components/company/p2-shared";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader title="Assistente" description="O seu gestor de RH: pergunte, peça ou fale. Faz o trabalho e só aplica depois de confirmar." />
      <AiBoundary>
        <AssistantChat
          scope={{ kind: "company", companyId }}
          userId={me.id}
          autoVoice={voz === "1"}
          suggestions={SUGGESTIONS}
          intro="Vejo tudo o que o seu papel permite e faço o trabalho por si: decidir justificações, demitir ou reactivar, editar fichas, criar colaboradores e acessos, salários, horários, planilhas e avisos ao responsável. Cada acção só acontece quando confirmar, no botão ou dizendo «confirmar». Toque em Falar para conversar por voz."
        />
      </AiBoundary>
    </>
  );
}
