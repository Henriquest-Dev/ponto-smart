"use client";

import { AnimatePresence, motion } from "motion/react";
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

  const errorBox = (
    <AnimatePresence initial={false}>
      {error ? (
        <motion.div
          key={error}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
          role="alert"
        >
          <p className="rounded-lg border-l-4 border-danger bg-danger-soft px-4 py-3 text-[13.5px] font-bold text-[#8e1f27]">
            {error}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

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
      <motion.div
        key={shakeKey}
        className={cn("space-y-3", shakeKey && "shake")}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
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
      </motion.div>

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
      <motion.h1
        className="text-[28px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[32px]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {title}
      </motion.h1>
      <motion.p
        className="mt-2 text-[15px] leading-relaxed text-muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {text}
      </motion.p>
    </div>
  );
}

function SubmitButton({ busy, done, label }: { busy: boolean; done: boolean; label: string }) {
  return (
    <motion.button
      type="submit"
      disabled={busy || done}
      whileTap={{ scale: 0.98 }}
      animate={{ backgroundColor: done ? "#16834f" : "#673fec" }}
      className="relative flex h-12 w-full items-center justify-center gap-3 overflow-hidden rounded-lg text-[15px] font-bold text-white disabled:cursor-default"
    >
      {busy && !done ? (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/15"
          initial={{ width: "0%" }}
          animate={{ width: "90%" }}
          transition={{ duration: 2.4, ease: [0.1, 0.6, 0.2, 1] }}
        />
      ) : null}
      <span className="relative">{done ? "Sessão iniciada" : busy ? "A verificar…" : label}</span>
    </motion.button>
  );
}
