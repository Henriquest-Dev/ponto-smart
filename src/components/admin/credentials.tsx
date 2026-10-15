"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
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
  const text = `PontoSmart — ${creds.company}\nEndereço: ${url}\nUtilizador: ${creds.login}\nPalavra-passe: ${creds.password}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-success-soft/60 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <KeyRound className="size-[18px]" />
        </span>
        <p className="text-[13px]">
          Acesso do responsável de <span className="font-semibold">{creds.company}</span> pronto a entregar.
        </p>
      </div>

      <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {[
          ["Endereço", url],
          ["Utilizador", creds.login],
          ["Palavra-passe", creds.password],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="shrink-0 text-xs text-muted">{k}</dt>
            <dd className="min-w-0 truncate text-right font-mono text-[13px] select-all">{v}</dd>
          </div>
        ))}
      </dl>

      <Notice tone="warning">
        A palavra-passe não pode ser consultada depois de fechar esta janela. Envie-a por um canal seguro; o responsável deve
        alterá-la no primeiro acesso (Segurança da conta) e depois criar os acessos da equipa.
      </Notice>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
        <Button
          onClick={async () => {
            if (await copy(text)) setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar credenciais"}
        </Button>
      </div>
    </div>
  );
}
