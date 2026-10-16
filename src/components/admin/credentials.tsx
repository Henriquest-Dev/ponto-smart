"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CredentialsMail } from "@/components/mail/send";
import { withBase } from "@/lib/sb/use-data";

export type Credentials = { company: string; login: string; password: string; email?: string | null; ownerName?: string | null };

/** Abre o programa de email do Super Admin com a mensagem já escrita (não há envio automático). */
export function mailto(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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
      <section aria-label="Credenciais do responsável" className="overflow-hidden rounded-xl border-2 border-foreground/90">
        <header className="flex items-start justify-between gap-4 bg-foreground px-5 py-4 text-background">
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold text-background/60">Acesso do responsável</p>
            <p className="mt-0.5 truncate text-[18px] font-bold tracking-[-0.01em]">{creds.company}</p>
          </div>
          <span className="shrink-0 pt-1 text-[12.5px] font-bold tracking-[-0.01em] text-background/80">Horbit</span>
        </header>
        <dl className="divide-y divide-border bg-background">
          {rows.map(([k, v, strong]) => (
            <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-4">
              <dt className="text-[12.5px] font-bold text-muted">{k}</dt>
              <dd className={strong ? "min-w-0 font-mono text-[15px] font-bold break-all select-all" : "min-w-0 font-mono text-[13px] break-all text-muted select-all"}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {creds.email ? (
        <CredentialsMail email={creds.email} name={creds.ownerName ?? ""} company={creds.company} login={creds.login} password={creds.password} owner />
      ) : null}

      <p className="rounded-lg border-l-4 border-warning bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-[#7a4b00]">
        A palavra-passe não volta a ser mostrada depois de fechar esta janela.{creds.email ? " Já seguiu para o email da empresa." : " Copie-a e entregue-a ao responsável."} O
        responsável deve alterá-la no primeiro acesso e depois criar os acessos da equipa.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button
          variant={creds.email || copied ? "outline" : "primary"}
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
