"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { errorMessage, loginEmail, sb } from "@/lib/sb/client";
import { homeFor, useSession } from "@/lib/sb/session";

export function LoginForm() {
  const { state, company } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Já com sessão (ou acabou de entrar): seguir para a área certa.
  useEffect(() => {
    if (state.status !== "ready") return;
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : null;
    router.replace(safeNext ?? homeFor(state.me, company));
  }, [state, company, next, router]);

  useEffect(() => {
    if (state.status === "error") {
      setError(state.message);
      setBusy(false);
    }
    if (state.status === "mfa") setBusy(false);
  }, [state]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const login = String(fd.get("login") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (login.length < 3 || !password) {
      setError("Indique o utilizador e a palavra-passe.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await sb().auth.signInWithPassword({ email: loginEmail(login), password });
    if (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
    // Sucesso: o SessionProvider carrega o perfil e o efeito acima redirecciona.
  }

  async function onMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { data } = await sb().auth.mfa.listFactors();
    const factor = data?.totp.find((f) => f.status === "verified");
    if (!factor) {
      setBusy(false);
      return setError("Sem método de verificação configurado.");
    }
    const { error: err } = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (err) {
      setBusy(false);
      setError("Código inválido. Confirme a hora do telemóvel e tente novamente.");
    }
  }

  if (state.status === "mfa") {
    return (
      <form onSubmit={onMfa} className="mt-8 space-y-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <p className="text-[14px] text-muted">Introduza o código de 6 dígitos da sua aplicação de autenticação.</p>
        <Field label="Código" htmlFor="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="tracking-[0.3em]" />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null} Verificar
        </Button>
        <button type="button" onClick={() => sb().auth.signOut()} className="h-10 w-full cursor-pointer text-[13px] text-muted hover:text-foreground">
          Usar outra conta
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Utilizador ou email" htmlFor="login">
        <Input id="login" name="login" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="ex.: ana.macuacua" />
      </Field>
      <Field label="Palavra-passe" htmlFor="password">
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-subtle hover:text-foreground"
            aria-label={show ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={busy || state.status === "loading"}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy ? "A entrar…" : "Entrar"}
      </Button>
    </form>
  );
}
