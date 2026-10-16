"use client";

import * as React from "react";
import { APP_VERSION } from "@/lib/app-version";

type State = { error: Error | null; key: number };

/** Se o assistente falhar, só esta parte mostra o erro; o resto da página continua a funcionar. */
export class AiBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error, key } = this.state;
    if (!error) return <React.Fragment key={key}>{this.props.children}</React.Fragment>;
    const stack = (error.stack ?? "").split("\n").slice(1, 5).map((l) => l.trim().replace(/https?:\/\/[^/]+/g, "")).join("\n");
    return (
      <section className="rounded-xl border border-border bg-background p-5 sm:p-6" role="alert">
        <h2 className="text-[16px] font-bold">O assistente teve um problema</h2>
        <p className="mt-1 text-[13.5px] text-muted">O resto da página continua a funcionar. Tente de novo; se repetir, envie ao suporte o texto abaixo.</p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-surface px-3 py-2.5 font-mono text-[11.5px] break-words whitespace-pre-wrap">
          {`${error.message}\nVersão: ${APP_VERSION}\n${typeof navigator === "undefined" ? "" : navigator.userAgent}\n${stack}`}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null, key: key + 1 })}
          className="mt-3 flex h-10 items-center rounded-lg bg-primary px-4 text-[14px] font-bold text-white hover:bg-primary-hover"
        >
          Tentar de novo
        </button>
      </section>
    );
  }
}
