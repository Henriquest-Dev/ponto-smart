"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { withBase } from "@/lib/sb/use-data";

export type Credentials = { company: string; login: string; password: string };

function loginUrl() {
  if (typeof window === "undefined") return "/login/";
  return `${window.location.origin}${withBase("/login/")}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado.");
    return true;
  } catch {
    toast.error("Não foi possível copiar. Seleccione o texto e copie manualmente.");
    return false;
  }
}

/** Credenciais do responsável para entregar à empresa (a palavra-passe não volta a ser mostrada). */
export function CredentialsPanel({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const url = loginUrl();
  const text = `Horbit — ${creds.company}\nEndereço: ${url}\nUtilizador: ${creds.login}\nPalavra-passe: ${creds.password}`;

  const rows: [string, string, boolean][] = [
    ["Endereço de entrada", url, false],
    ["Utilizador", creds.login, true],
    ["Palavra-passe", creds.password, true],
  ];

  return (
    <div className="space-y-5">
      <section aria-label="Credenciais do responsável" className="overflow-hidden rounded-[22px] border-2 border-foreground/90">
        <header className="flex items-start justify-between gap-4 bg-foreground px-5 py-4 text-background">
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold text-background/60">Acesso do responsável</p>
            <p className="mt-0.5 truncate text-[18px] font-extrabold tracking-[-0.01em]">{creds.company}</p>
          </div>
          <span className="shrink-0 pt-1 text-[12.5px] font-extrabold tracking-[-0.01em] text-background/80">Horbit</span>
        </header>
        <dl className="divide-y divide-border bg-background">
          {rows.map(([k, v, strong]) => (
            <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-4">
              <dt className="flex items-center gap-2 text-[12.5px] font-bold text-muted">
                <span className="stem h-3 text-primary" aria-hidden />
                {k}
              </dt>
              <dd className={strong ? "min-w-0 font-mono text-[15px] font-bold break-all select-all" : "min-w-0 font-mono text-[13px] break-all text-muted select-all"}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
        <span className="stem mt-1 shrink-0 text-warning" aria-hidden />
        <span>
          A palavra-passe não volta a ser mostrada depois de fechar esta janela. Entregue-a por um canal seguro; o responsável
          deve alterá-la no primeiro acesso (Segurança da conta) e depois criar os acessos da equipa.
        </span>
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button
          variant={copied ? "outline" : "primary"}
          onClick={async () => {
            if (await copy(text)) setCopied(true);
          }}
        >
          {copied ? "Credenciais copiadas" : "Copiar credenciais"}
        </Button>
      </div>
    </div>
  );
}
