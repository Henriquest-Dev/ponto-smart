"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FloatField } from "@/components/brand/float-field";
import { Checkbox } from "@/components/ui/input";
import { errorMessage, loginEmail, sb } from "@/lib/sb/client";
import { homeFor, useSession } from "@/lib/sb/session";
import { cn } from "@/lib/utils";

const REMEMBER_KEY = "horbit-utilizador";

function readRemembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function LoginForm() {
  const { state, company } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [caps, setCaps] = useState(false);
  const [remembered, setRemembered] = useState<string | null>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRemembered(readRemembered()), []);

  // Já com sessão (ou acabou de entrar): seguir para a área certa.
  useEffect(() => {
    if (state.status !== "ready") return;
    setDone(true);
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : null;
    const t = setTimeout(() => router.replace(safeNext ?? homeFor(state.me, company)), busy ? 650 : 0);
    return () => clearTimeout(t);
  }, [state, company, next, router, busy]);

  useEffect(() => {
    if (state.status === "error") {
      setError(state.message);
      setBusy(false);
      setShakeKey((k) => k + 1);
    }
    if (state.status === "mfa") setBusy(false);
  }, [state]);

  function fail(message: string) {
    setError(message);
    setBusy(false);
    setShakeKey((k) => k + 1);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const login = String(fd.get("login") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (login.length < 3) return fail("Escreva o seu utilizador ou email.");
    if (!password) {
      passRef.current?.focus();
      return fail("Escreva a palavra-passe.");
    }
    try {
      if (fd.get("remember")) localStorage.setItem(REMEMBER_KEY, login);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {}
    setBusy(true);
    setError(null);
    const { error: err } = await sb().auth.signInWithPassword({ email: loginEmail(login), password });
    if (err) fail(errorMessage(err));
    // Sucesso: o SessionProvider carrega o perfil e o efeito acima redirecciona.
  }

  async function onMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { data } = await sb().auth.mfa.listFactors();
    const factor = data?.totp.find((f) => f.status === "verified");
    if (!factor) return fail("Sem método de verificação configurado.");
    const { error: err } = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (err) fail("Código inválido. Confirme a hora do telemóvel e tente novamente.");
  }

  const errorBox = error ? (
    <div key={error} role="alert">
      <p className="rounded-lg border-l-4 border-danger bg-danger-soft px-4 py-3 text-[13.5px] font-bold text-[#8e1f27]">
        {error}
      </p>
    </div>
  ) : null;

  if (state.status === "mfa") {
    return (
      <form onSubmit={onMfa} className="space-y-5">
        <Heading title="Confirme que é você" text="Abra a aplicação de autenticação e escreva o código de 6 dígitos." />
        {errorBox}
        <div key={shakeKey} className={cn(shakeKey && "shake")}>
          <FloatField label="Código de verificação" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required className="[&_input]:tracking-[0.4em]" />
        </div>
        <SubmitButton busy={busy} done={false} label="Verificar" />
        <button type="button" onClick={() => sb().auth.signOut()} className="h-10 w-full rounded-lg text-[13.5px] font-bold text-muted hover:bg-surface-2">
          Entrar com outra conta
        </button>
      </form>
    );
  }

  if (remembered === null) return <div className="h-[420px]" />;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Heading
        title={remembered ? "Bem-vindo de volta" : "Entrar"}
        text={remembered ? `Continue como ${remembered} ou use outra conta.` : "Use o utilizador e a palavra-passe que recebeu da sua empresa."}
      />
      {errorBox}
      <div key={shakeKey} className={cn("space-y-3", shakeKey && "shake")}>
        <FloatField
          label="Utilizador ou email"
          name="login"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={remembered}
          autoFocus={!remembered}
          invalid={!!error && !busy}
        />
        <FloatField
          ref={passRef}
          label="Palavra-passe"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          autoFocus={!!remembered}
          invalid={!!error && !busy}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          trailing={
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="h-9 rounded-md px-3 text-[13px] font-bold text-muted hover:bg-surface-2 hover:text-foreground"
              aria-pressed={show}
            >
              {show ? "Ocultar" : "Mostrar"}
            </button>
          }
          hint={caps ? <span className="font-bold text-warning">As maiúsculas estão activas.</span> : null}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] font-medium">
        <Checkbox name="remember" defaultChecked={!!remembered} />
        Lembrar o meu utilizador neste dispositivo
      </label>

      <SubmitButton busy={busy || state.status === "loading"} done={done} label="Entrar" />

      <p className="text-[12.5px] leading-relaxed text-muted">
        Esqueceu a palavra-passe? Peça ao responsável ou ao RH da sua empresa para a redefinir.
      </p>
    </form>
  );
}

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-2">
      <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[32px]">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function SubmitButton({ busy, done, label }: { busy: boolean; done: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy || done}
      className={cn(
        "relative flex h-12 w-full items-center justify-center gap-3 overflow-hidden rounded-lg text-[15px] font-bold text-white transition-colors disabled:cursor-default",
        done ? "bg-success" : "bg-primary",
      )}
    >
      <span className="relative">{done ? "Sessão iniciada" : busy ? "A verificar…" : label}</span>
    </button>
  );
}
