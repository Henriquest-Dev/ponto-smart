"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/shell/logo";
import { APP_VERSION, isOutdated, reloadFresh } from "@/lib/app-version";

/** Erro numa página: mostra o motivo e permite tentar de novo, em vez do ecrã em branco do Next. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen error={error} onRetry={reset} />;
}

/** Texto para o suporte: mensagem, página, versão, navegador e as primeiras linhas da pilha. */
function details(error: Error) {
  const stack = (error.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(error.message))
    .slice(0, 6)
    .map((l) => l.replace(/https?:\/\/[^/]+/g, ""));
  return [
    error.message,
    `Página: ${typeof window === "undefined" ? "" : window.location.pathname}`,
    `Versão: ${APP_VERSION}`,
    `Navegador: ${typeof navigator === "undefined" ? "" : navigator.userAgent}`,
    ...stack,
  ].join("\n");
}

export function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [text, setText] = useState(error.message);
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setText(details(error));
    // Código antigo em memória (a app estava aberta durante uma publicação): recarrega uma vez com o código novo.
    void isOutdated().then((old) => {
      if (!old) return;
      try {
        if (sessionStorage.getItem("horbit-auto-update") === APP_VERSION) return;
        sessionStorage.setItem("horbit-auto-update", APP_VERSION);
      } catch {}
      setUpdating(true);
      void reloadFresh();
    });
  }, [error]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {}
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 py-6 sm:px-10">
      <Wordmark className="h-7" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">Algo correu mal nesta página</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Os seus dados estão guardados. Tente de novo; se o erro continuar, envie ao suporte o texto abaixo.
        </p>
        {updating ? (
          <p className="mt-4 text-[14px] font-bold text-primary">Há uma versão nova do Horbit. A actualizar…</p>
        ) : null}
        <pre className="mt-4 max-h-56 overflow-auto rounded-lg border border-border bg-surface px-4 py-3 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
          {text}
        </pre>
        <button type="button" onClick={copy} className="mt-2 self-start text-[13px] font-bold text-primary hover:underline">
          {copied ? "Copiado" : "Copiar detalhes"}
        </button>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => {
              setUpdating(true);
              void reloadFresh();
            }}
            className="flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-[15px] font-bold text-white hover:bg-primary-hover"
          >
            Recarregar a aplicação
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-12 items-center justify-center rounded-lg border border-border-strong px-6 text-[15px] font-bold hover:bg-surface-2"
          >
            Tentar de novo
          </button>
          <Link href="/inicio/" className="flex h-12 items-center justify-center rounded-lg border border-border-strong px-6 text-[15px] font-bold hover:bg-surface-2">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
