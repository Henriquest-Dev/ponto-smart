"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock } from "@/components/company/p2-shared";
import { sendMail } from "@/components/mail/send";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { useSession } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";

type Settings = { smtpHost: string; smtpPort: number; smtpUser: string | null; smtpHasPass: boolean; fromName: string; sentToday: number };
type Status = { configured: boolean; via?: string; user?: string; ok?: boolean; error?: string | null };

/** Envio de emails: uma única conta (SMTP) envia tudo — configura-se uma vez. */
export default function EmailsPage() {
  const { me } = useSession();
  const settings = useData(() => rpc<Settings>("ps_mail_settings"), []);
  const status = useData(async () => {
    const { data, error } = await sb().functions.invoke(AI_FUNCTION, { body: { mode: "mail_status" } });
    if (error) return { configured: false, error: "Publique a versão nova da função Ponto-ai no Supabase." } as Status;
    return data as Status;
  }, [settings.data?.smtpUser, settings.data?.smtpHasPass, settings.data?.smtpHost, settings.data?.smtpPort]);
  const [user, setUser] = React.useState("");
  const [pass, setPass] = React.useState("");
  const [from, setFrom] = React.useState("Horbit");
  const [host, setHost] = React.useState("smtp.gmail.com");
  const [port, setPort] = React.useState("465");
  const [testTo, setTestTo] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!settings.data) return;
    setUser(settings.data.smtpUser ?? "");
    setFrom(settings.data.fromName);
    setHost(settings.data.smtpHost);
    setPort(String(settings.data.smtpPort));
  }, [settings.data]);
  React.useEffect(() => {
    if (!testTo && me?.login?.includes("@")) setTestTo(me.login);
  }, [me, testTo]);

  const save = async () => {
    setBusy("save");
    try {
      await rpc("ps_mail_smtp_set", { p_user: user.trim(), p_pass: pass.trim() || null, p_host: host.trim(), p_port: Number(port) || 465, p_from_name: from });
      setPass("");
      settings.reload();
      toast.success("Guardado. A verificar a ligação…");
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
    if (r.ok) toast.success(`Email de teste enviado para ${testTo}.`);
    else toast.error(r.error);
  };
  const s = status.data;
  const working = s?.configured && s.ok;

  return (
    <>
      <PageHeader title="Emails" description="Uma só conta de email envia tudo, sozinha: credenciais dos responsáveis e dos colaboradores, pedidos de dados e avisos." />
      <PageBody className="max-w-3xl">
        {settings.error ? (
          <ErrorBlock message={/ps_mail|função em falta|schema cache/i.test(settings.error) ? "Corra os scripts supabase/04_parte14.sql e 04_parte15.sql no Supabase." : settings.error} />
        ) : null}
        {!settings.data && !settings.error ? <LoadingBlock rows={3} /> : null}
        {settings.data ? (
          <>
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
                      {!s || status.loading
                        ? "A verificar a ligação…"
                        : working
                          ? `Ligado: os emails saem de ${s.user ?? settings.data.smtpUser}`
                          : s.configured
                            ? "A ligação ao servidor de email falhou"
                            : "O envio automático ainda não está ligado"}
                    </p>
                    <p className="text-[13px] text-muted">
                      {working
                        ? `Enviados hoje pelo Horbit: ${settings.data.sentToday}. Não precisa de configurar mais nada nem nenhum perfil.`
                        : s?.error ?? "Preencha o email e a palavra-passe de app abaixo e guarde."}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={status.reload}>Verificar</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Conta que envia os emails</CardTitle>
                  <CardDescription>Configura-se uma vez. Os colaboradores não configuram nada: recebem os emails no endereço que está na ficha.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Email que envia">
                      <Input value={user} onChange={(e) => setUser(e.target.value)} type="email" placeholder="horbit.mz@gmail.com" autoComplete="off" required />
                    </Field>
                    <Field label="Nome que aparece">
                      <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Horbit" />
                    </Field>
                    <Field
                      label="Palavra-passe de app"
                      hint={settings.data.smtpHasPass ? "Já está guardada. Deixe vazio para a manter." : "16 letras, criada na conta Google (ver abaixo)."}
                      className="sm:col-span-2"
                    >
                      <Input
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                        type="password"
                        placeholder={settings.data.smtpHasPass ? "••••••••••••••••" : "abcd efgh ijkl mnop"}
                        autoComplete="new-password"
                        className="font-mono"
                      />
                    </Field>
                  </div>
                  <details className="rounded-lg border border-border px-3 py-2 text-[13px]">
                    <summary className="cursor-pointer font-bold">Outro fornecedor (não Gmail)</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
                      <Field label="Servidor SMTP"><Input value={host} onChange={(e) => setHost(e.target.value)} /></Field>
                      <Field label="Porta"><Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" /></Field>
                    </div>
                    <p className="mt-2 text-muted">Use a porta 465 (SSL): o Supabase bloqueia as portas 25 e 587.</p>
                  </details>
                  <Button type="submit" disabled={busy !== null}>
                    {busy === "save" ? <span className="spinner" aria-hidden /> : null} Guardar
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Enviar um email de teste</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 sm:flex-row">
                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="o.seu.email@gmail.com" type="email" aria-label="Email para o teste" />
                <Button variant="outline" onClick={() => void test()} disabled={busy !== null || !testTo.includes("@") || !working}>
                  {busy === "test" ? <span className="spinner" aria-hidden /> : null} Enviar teste
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Como criar a palavra-passe de app do Gmail</CardTitle>
                  <CardDescription>A palavra-passe normal do Gmail não funciona aqui; o Google exige uma palavra-passe de app.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-[13.5px] leading-relaxed">
                <p>1. Entre na conta Google do email que vai enviar e ligue a <b>Verificação em dois passos</b> (Segurança).</p>
                <p>
                  2. Abra{" "}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-bold text-primary underline underline-offset-4">
                    myaccount.google.com/apppasswords
                  </a>
                  , escreva o nome &quot;Horbit&quot; e carregue em Criar.
                </p>
                <p>3. Copie as 16 letras que aparecem, cole no campo acima e guarde.</p>
                <p className="text-muted">Uma conta Gmail normal envia até cerca de 500 emails por dia. Se mudar a palavra-passe da conta Google, crie uma palavra-passe de app nova.</p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </>
  );
}
