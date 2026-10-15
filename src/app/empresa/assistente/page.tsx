"use client";

import { AssistantChat } from "@/components/ai/assistant-chat";
import { NoAccess } from "@/components/company/p2-shared";
import { PageHeader } from "@/components/ui/page-header";
import { useCompany } from "@/lib/sb/session";

const SUGGESTIONS = [
  "Olá! Como está a equipa hoje?",
  "Quem chegou atrasado mais vezes nos últimos 30 dias?",
  "Que justificações estão por decidir?",
  "Como faço para fechar os salários do mês?",
];

export default function AssistantPage() {
  const { can, companyId, me } = useCompany();
  if (!can("ai.use")) return <NoAccess title="Assistente" />;
  return (
    <>
      <PageHeader title="Assistente" description="Converse sobre a assiduidade, as justificações e os salários, ou pergunte como usar o Horbit." />
      <AssistantChat
        scope={{ kind: "company", companyId }}
        userId={me.id}
        suggestions={SUGGESTIONS}
        intro="Uso os dados da empresa que o seu papel permite ver e explico como usar cada página. Não aprovo, não pago e não aplico sanções."
      />
    </>
  );
}
