"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { LoadingScreen } from "@/components/shell/area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { errorMessage, loginEmail, sb } from "@/lib/sb/client";
import { homeFor, useSession } from "@/lib/sb/session";

export default function AccountPage() {
  const { state, me, company } = useSession();
  const router = useRouter();
  React.useEffect(() => {
    if (state.status === "anon") router.replace("/login/?next=/conta/");
  }, [state, router]);
  if (!me) return <LoadingScreen />;

  return (
    <div className="min-h-dvh lg:p-3">
      <div className="min-h-dvh bg-background lg:min-h-[calc(100dvh-24px)] lg:rounded-xl lg:shadow-panel">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
          <Logo />
          <Link href={homeFor(me, company)} className="inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-bold text-muted hover:bg-surface-2 hover:text-foreground">
            Voltar
          </Link>
        </header>
        <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-8">
          <div>
            <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.02em]">Segurança da conta</h1>
            <p className="mt-2 text-[14px] text-muted">
              {me.name}, utilizador <span className="font-bold text-foreground">{me.login}</span>
            </p>
          </div>
          <PasswordCard login={me.login} />
          <MfaCard />
        </main>
      </div>
    </div>
  );
}

function PasswordCard({ login }: { login: string }) {
  const [busy, setBusy] = React.useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (next.length < 8) return toast.error("A nova palavra-passe deve ter pelo menos 8 caracteres.");
    if (next !== confirm) return toast.error("As palavras-passe não coincidem.");
    setBusy(true);
    // Confirma a palavra-passe actual antes de alterar.
    const check = await sb().auth.signInWithPassword({ email: loginEmail(login), password: current });
    if (check.error) {
      setBusy(false);
      return toast.error("A palavra-passe actual está incorrecta.");
    }
    const { error } = await sb().auth.updateUser({ password: next });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    form.reset();
    toast.success("Palavra-passe alterada.");
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Palavra-passe</CardTitle>
          <CardDescription>Mínimo de 8 caracteres. Não reutilize palavras-passe de outros serviços.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-sm">
          <Field label="Palavra-passe actual" htmlFor="current">
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="Nova palavra-passe" htmlFor="next">
            <Input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Repetir nova palavra-passe" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Button type="submit" disabled={busy} className="w-fit">
            {busy ? <span className="spinner" /> : null} Alterar palavra-passe
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type Factor = { id: string; status: string; friendly_name?: string };

function MfaCard() {
  const [factors, setFactors] = React.useState<Factor[] | null>(null);
  const [enroll, setEnroll] = React.useState<{ id: string; qr: string; secret: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const { data } = await sb().auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const active = factors?.find((f) => f.status === "verified");

  async function start() {
    setBusy(true);
    // Remove tentativas anteriores não concluídas.
    for (const f of factors ?? []) if (f.status !== "verified") await sb().auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: `Horbit ${Date.now()}` });
    setBusy(false);
    if (error || !data) return toast.error(errorMessage(error));
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enroll) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
    setBusy(false);
    if (error) return toast.error("Código inválido. Confirme a hora do telemóvel e tente novamente.");
    setEnroll(null);
    toast.success("Verificação em dois passos activada.");
    void load();
  }

  async function disable() {
    if (!active || !window.confirm("Desactivar a verificação em dois passos?")) return;
    setBusy(true);
    const { error } = await sb().auth.mfa.unenroll({ factorId: active.id });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Verificação em dois passos desactivada.");
    void load();
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Verificação em dois passos</CardTitle>
          <CardDescription>Código de 6 dígitos de uma aplicação de autenticação (Google Authenticator, Microsoft Authenticator).</CardDescription>
        </div>
        {factors === null ? null : active ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}
      </CardHeader>
      <CardContent>
        {active ? (
          <Button variant="danger-outline" onClick={disable} disabled={busy}>
            Desactivar
          </Button>
        ) : enroll ? (
          <form onSubmit={verify} className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Código QR para a aplicação de autenticação" className="size-[180px] rounded-lg border border-border bg-white p-2" />
            <div className="space-y-3">
              <p className="text-[13.5px] leading-relaxed text-muted">
                Leia o código com a aplicação ou introduza a chave <span className="font-mono text-foreground break-all">{enroll.secret}</span>.
              </p>
              <Field label="Código de 6 dígitos" htmlFor="code">
                <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className="max-w-40" />
              </Field>
              <Button type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : null} Confirmar e activar
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="soft" onClick={start} disabled={busy || factors === null}>
            Configurar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
