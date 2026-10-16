"use client";

import { CheckCircle, Copy, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock } from "@/components/company/p2-shared";
import { sendMail } from "@/components/mail/send";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { appsScriptCode } from "@/lib/apps-script";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { useSession } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";

type Settings = { url: string | null; secret: string; fromName: string; sentToday: number };
type Status = { configured: boolean; ok?: boolean; quota?: number | null; error?: string | null; resend?: boolean };

export default function EmailsPage() {
  const { me } = useSession();
  const settings = useData(() => rpc<Settings>("ps_mail_settings"), []);
  const status = useData(async () => {
    const { data, error } = await sb().functions.invoke(AI_FUNCTION, { body: { mode: "mail_status" } });
    if (error) return { configured: false, error: "A função Ponto-ai ainda não tem o envio de emails: publique a versão nova." } as Status;
    return data as Status;
  }, [settings.data?.url, settings.data?.secret]);
  const [url, setUrl] = React.useState("");
  const [from, setFrom] = React.useState("Horbit");
  const [testTo, setTestTo] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (settings.data) {
      setUrl(settings.data.url ?? "");
      setFrom(settings.data.fromName);
    }
  }, [settings.data]);
  React.useEffect(() => {
    if (me?.login?.includes("@") && !testTo) setTestTo(me.login);
  }, [me, testTo]);

  const save = async (newSecret = false) => {
    setBusy(newSecret ? "secret" : "save");
    try {
      await rpc("ps_mail_settings_set", { p_url: url.trim() || null, p_from_name: from, p_new_secret: newSecret });
      settings.reload();
      toast.success(newSecret ? "Segredo novo criado. Cole o código de novo no Apps Script." : "Configuração guardada.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    const r = await sendMail({ kind: "test", to: testTo.trim() });
    setBusy(null);
    if (r.ok) toast.success(`Email de teste enviado para ${testTo}. Veja a caixa de entrada (e o spam, da primeira vez).`);
    else toast.error(r.error);
    status.reload();
  };
  const code = settings.data ? appsScriptCode(settings.data.secret) : "";
  const s = status.data;

  return (
    <>
      <PageHeader title="Emails" description="Envio automático das credenciais e dos avisos pelo Gmail da empresa-mãe, sem servidor SMTP." />
      <PageBody className="max-w-4xl">
        {settings.error ? <ErrorBlock message={/ps_mail_settings|função em falta|schema cache/i.test(settings.error) ? "Corra o script supabase/04_parte14.sql no Supabase." : settings.error} /> : null}
        {!settings.data && !settings.error ? <LoadingBlock rows={3} /> : null}
        {settings.data ? (
          <>
            <Card>
              <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  {s?.configured && s.ok ? (
                    <CheckCircle className="mt-0.5 size-6 shrink-0 text-success" weight="fill" aria-hidden />
                  ) : (
                    <WarningCircle className="mt-0.5 size-6 shrink-0 text-warning" weight="fill" aria-hidden />
                  )}
                  <div>
                    <p className="text-[15px] font-bold">
                      {!s ? "A verificar…" : s.configured && s.ok ? "O envio de emails está a funcionar" : s.configured ? "O Apps Script não respondeu bem" : "O envio automático ainda não está ligado"}
                    </p>
                    <p className="text-[13px] text-muted">
                      {s?.configured && s.ok
                        ? `Pode enviar mais ${s.quota ?? "?"} emails hoje por este Gmail. Enviados hoje pelo Horbit: ${settings.data.sentToday}.`
                        : s?.error ?? (s?.resend ? "Está a ser usado o Resend (RESEND_API_KEY)." : "Siga os passos abaixo. Até lá, os botões abrem o seu programa de email.")}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={status.reload}>Verificar de novo</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Ligar o Gmail (uma vez, cerca de 5 minutos)</CardTitle>
                  <CardDescription>Faça estes passos com a conta Gmail que vai enviar os emails (a da empresa-mãe).</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ol className="space-y-5">
                  <Step n={1} title="Abrir o Google Apps Script">
                    <p>Com a conta Gmail da empresa-mãe aberta no navegador, crie um projecto novo.</p>
                    <Button asChild size="sm" variant="soft" className="mt-2">
                      <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">Abrir script.google.com</a>
                    </Button>
                  </Step>
                  <Step n={2} title="Colar o código">
                    <p>Apague o que estiver no editor, cole este código e carregue em Guardar (ícone da disquete). Dê-lhe o nome &quot;Horbit email&quot;.</p>
                    <div className="relative mt-2">
                      <pre className="max-h-64 overflow-auto rounded-lg bg-foreground p-4 text-[11.5px] leading-relaxed text-white/90"><code>{code}</code></pre>
                      <Button
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => void navigator.clipboard.writeText(code).then(() => toast.success("Código copiado."), () => toast.error("Não foi possível copiar."))}
                      >
                        <Copy className="size-4" aria-hidden /> Copiar código
                      </Button>
                    </div>
                  </Step>
                  <Step n={3} title="Autorizar o Gmail">
                    <p>
                      No topo, escolha a função <b>autorizar</b> e carregue em <b>Executar</b>. Aceite as permissões com a mesma conta. Se aparecer &quot;A Google não
                      verificou esta app&quot;, carregue em <b>Avançadas</b> → <b>Aceder a Horbit email</b>: a app é sua, só envia emails em seu nome.
                    </p>
                  </Step>
                  <Step n={4} title="Publicar como aplicação web">
                    <p>
                      Carregue em <b>Implementar</b> → <b>Nova implementação</b> → tipo <b>Aplicação Web</b>. Em &quot;Executar como&quot; escolha <b>Eu</b> e em &quot;Quem tem
                      acesso&quot; escolha <b>Qualquer pessoa</b>. Carregue em Implementar e copie o <b>URL da aplicação web</b> (termina em /exec).
                    </p>
                  </Step>
                  <Step n={5} title="Colar o URL aqui e guardar">
                    <div className="mt-1 grid gap-3 sm:grid-cols-[1fr_200px]">
                      <Field label="URL da aplicação web">
                        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className="font-mono text-[13px]" />
                      </Field>
                      <Field label="Nome do remetente">
                        <Input value={from} onChange={(e) => setFrom(e.target.value)} />
                      </Field>
                    </div>
                    <Button className="mt-3" onClick={() => void save()} disabled={busy !== null}>
                      {busy === "save" ? <span className="spinner" aria-hidden /> : null} Guardar
                    </Button>
                  </Step>
                  <Step n={6} title="Enviar um email de teste">
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                      <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="o.seu.email@gmail.com" type="email" aria-label="Email para o teste" />
                      <Button variant="outline" onClick={() => void test()} disabled={busy !== null || !testTo.includes("@")}>
                        {busy === "test" ? <span className="spinner" aria-hidden /> : null} Enviar teste
                      </Button>
                    </div>
                  </Step>
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>O que é enviado automaticamente</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-[13.5px] leading-relaxed">
                <p>• Ao criar uma empresa: as credenciais do responsável vão para o email da empresa.</p>
                <p>• Ao criar o acesso de um colaborador ou repor a palavra-passe: as credenciais vão para o email que está na ficha.</p>
                <p>• Avisos do assistente ao responsável e o pedido de dados aos novos clientes.</p>
                <p className="text-muted">
                  Uma conta Gmail normal envia até 100 emails por dia; uma conta Google Workspace até 1500. As empresas só conseguem enviar para emails dos próprios
                  colaboradores.
                </p>
                <Button variant="danger-outline" size="sm" className={cn("mt-2")} onClick={() => window.confirm("Criar um segredo novo? O código no Apps Script deixa de funcionar até o colar de novo.") && void save(true)} disabled={busy !== null}>
                  Gerar segredo novo
                </Button>
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_1fr] gap-3">
      <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[14px] font-bold text-primary">{n}</span>
      <div className="min-w-0 text-[13.5px] leading-relaxed">
        <p className="mb-1 text-[14.5px] font-bold">{title}</p>
        {children}
      </div>
    </li>
  );
}
