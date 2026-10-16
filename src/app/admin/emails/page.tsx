"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { sendMail } from "@/components/mail/send";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { rpc, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";

const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";

type Status = { configured: boolean; via?: string; user?: string; ok?: boolean; error?: string | null };

/** Envio de emails integrado: só mostra o estado e permite um teste (não há nada para configurar). */
export default function EmailsPage() {
  const status = useData(async () => {
    const { data, error } = await sb().functions.invoke(AI_FUNCTION, { body: { mode: "mail_status" } });
    if (error) return { configured: false, error: "Publique a versão nova da função Ponto-ai no Supabase." } as Status;
    return data as Status;
  }, []);
  const today = useData(() => rpc<{ sentToday: number }>("ps_mail_settings").catch(() => ({ sentToday: 0 })), []);
  const [busy, setBusy] = React.useState(false);
  const s = status.data;
  const working = !!(s?.configured && s.ok);

  const test = async () => {
    setBusy(true);
    const r = await sendMail({ kind: "test" });
    setBusy(false);
    if (r.ok) toast.success(`Email de teste enviado para ${r.to?.[0] ?? s?.user}. Veja a caixa de entrada.`);
    else toast.error(r.error);
  };

  return (
    <>
      <PageHeader title="Emails" description="O envio de emails está integrado no Horbit: não há nada para configurar." />
      <PageBody className="max-w-3xl">
        <Card>
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {working ? (
                <CheckCircle className="mt-0.5 size-6 shrink-0 text-success" weight="fill" aria-hidden />
              ) : (
                <WarningCircle className="mt-0.5 size-6 shrink-0 text-warning" weight="fill" aria-hidden />
              )}
              <div>
                <p className="text-[15px] font-bold">
                  {!s || status.loading ? "A verificar a ligação…" : working ? `A funcionar: os emails saem de ${s.user}` : "A ligação ao Gmail falhou"}
                </p>
                <p className="text-[13px] text-muted">
                  {working ? `Enviados hoje pelo Horbit: ${today.data?.sentToday ?? 0}.` : s?.error ?? ""}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={status.reload}>Verificar</Button>
              <Button size="sm" disabled={!working || busy} onClick={() => void test()}>
                {busy ? <span className="spinner" aria-hidden /> : null} Enviar teste
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>O que o Horbit envia sozinho</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13.5px] leading-relaxed">
            <p>• Credenciais do responsável, ao criar uma empresa ou repor a palavra-passe.</p>
            <p>• Credenciais de cada colaborador, ao criar o acesso, repor a palavra-passe ou pelo assistente (vão para o email da ficha).</p>
            <p>• Comunicados que as empresas escrevem aos colaboradores (menu Comunicados), com o nome e os contactos da empresa.</p>
            <p>• Pedidos de dados aos novos clientes e avisos do assistente ao responsável.</p>
            <p className="text-muted">Todos os emails saem com o nome Horbit. Uma conta Gmail envia até cerca de 500 emails por dia.</p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
