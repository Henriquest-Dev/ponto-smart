"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { CheckCircle, EnvelopeSimple, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, sb } from "@/lib/sb/client";
import { withBase } from "@/lib/sb/use-data";

/** Mesma Edge Function do assistente ("Ponto-ai"). */
const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";

export type MailRequest = {
  companyId?: string | null;
  kind: "credentials" | "message" | "test" | "company";
  to?: string | string[];
  data?: { name?: string; company?: string; login?: string; password?: string; url?: string; role?: string; owner?: boolean; subject?: string; text?: string };
};
export type MailResult = { ok: true; via: string; sent?: number; to?: string[] } | { ok: false; error: string; notConfigured?: boolean };

export function loginUrl() {
  return typeof window === "undefined" ? "" : `${window.location.origin}${withBase("/login/")}`;
}

/** Envia um email pelo Horbit (Gmail da empresa-mãe). Nunca lança: devolve o resultado. */
export async function sendMail(req: MailRequest): Promise<MailResult> {
  try {
    const { data, error } = await sb().functions.invoke(AI_FUNCTION, { body: { mode: "mail", ...req, data: { url: loginUrl(), ...req.data } } });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const res = error.context as Response | undefined;
        const j = (await res?.json().catch(() => null)) as { error?: string; notConfigured?: boolean } | null;
        if (res?.status === 404) return { ok: false, notConfigured: true, error: "A função de email ainda não está publicada no Supabase." };
        return { ok: false, notConfigured: !!j?.notConfigured, error: j?.error ?? "O email não foi enviado." };
      }
      return { ok: false, error: errorMessage(error) };
    }
    const d = (data ?? {}) as { via?: string; sent?: number; to?: string[] };
    return { ok: true, via: d.via ?? "smtp", sent: d.sent, to: d.to };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export function mailtoHref(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Envia as credenciais por email assim que aparecem (uma vez) e mostra o resultado.
 * Se o envio automático não estiver configurado, oferece abrir o programa de email.
 */
export function CredentialsMail({
  email,
  name,
  company,
  companyId,
  login,
  password,
  owner,
  role,
}: {
  email: string | null | undefined;
  name: string;
  company?: string;
  companyId?: string | null;
  login: string;
  password: string | null;
  owner?: boolean;
  role?: string;
}) {
  type Failed = Extract<MailResult, { ok: false }>;
  const [state, setState] = React.useState<"idle" | "sending" | "sent" | Failed>("idle");
  const started = React.useRef(false);
  const send = React.useCallback(async () => {
    if (!email || !password) return;
    setState("sending");
    const r = await sendMail({ companyId, kind: "credentials", to: email, data: { name, company, login, password, owner, role } });
    setState(r.ok ? "sent" : (r as Failed));
  }, [email, password, companyId, name, company, login, owner, role]);
  React.useEffect(() => {
    if (started.current || !email || !password) return;
    started.current = true;
    void send();
  }, [email, password, send]);

  if (!password) return null;
  if (!email)
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2.5 text-[13px] text-muted">
        <EnvelopeSimple className="mt-0.5 size-4 shrink-0" aria-hidden />
        Sem email na ficha: as credenciais não foram enviadas por email. Escreva o email na ficha para o envio ser automático da próxima vez.
      </p>
    );
  if (state === "sending" || state === "idle")
    return (
      <p className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-[13px] text-muted">
        <span className="spinner" aria-hidden /> A enviar as credenciais para {email}…
      </p>
    );
  if (state === "sent")
    return (
      <p className="flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2.5 text-[13px] text-[#0b5c35]">
        <CheckCircle className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
        <span>
          Credenciais enviadas por email para <b>{email}</b>.
        </span>
      </p>
    );
  return (
    <div className="space-y-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-[#6f4100]">
      <p className="flex items-start gap-2">
        <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
        <span>{`O email para ${email} não foi enviado: ${state.notConfigured || /Escreva uma mensagem/.test(state.error) ? "a função de email do servidor ainda não foi actualizada." : state.error}`}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void send()}>
          Tentar de novo
        </Button>
      </div>
    </div>
  );
}
