"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Wordmark } from "@/components/shell/logo";

/** Erro numa página: mostra o motivo e permite tentar de novo, em vez do ecrã em branco do Next. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen message={error.message} onRetry={reset} />;
}

export function ErrorScreen({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-5 py-6 sm:px-10">
      <Wordmark className="h-7" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">Algo correu mal nesta página</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Os seus dados estão guardados. Tente de novo; se o erro continuar, envie ao suporte o texto abaixo.
        </p>
        {message ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-[12.5px] break-words text-foreground">{message}</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onRetry}
            className="flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-[15px] font-bold text-white hover:bg-primary-hover"
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
