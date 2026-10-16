"use client";

import Link from "next/link";
import * as React from "react";
import { AiActions, askAssistant, NOT_ACTIVE, type AiAction, type AiReply } from "@/components/ai/actions";
import { RichText } from "@/components/ai/assistant-chat";
import { canSpeak, speak, stopSpeaking } from "@/components/ai/voice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";

type Cached = AiReply & { at: string };

/** Análise automática do assistente (gestor de RH) no Painel: corre sozinha, no máximo uma vez por hora neste dispositivo. */
export function AiInsights({ companyId, tz }: { companyId: string; tz: string }) {
  const hourKey = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).format(new Date());
  const key = `horbit-ia-analise:${companyId}:${hourKey}`;
  const [data, setData] = React.useState<Cached | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inactive, setInactive] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const [ttsOk, setTtsOk] = React.useState(false);
  React.useEffect(() => {
    setTtsOk(canSpeak());
    return () => stopSpeaking();
  }, []);

  /** Lê em voz alta o que se passa agora: a análise e as acções propostas. */
  const listenSummary = async () => {
    if (!data) return;
    if (speaking) {
      stopSpeaking();
      return setSpeaking(false);
    }
    setSpeaking(true);
    const pending = data.actions.filter((a) => !a.state).map((a) => a.label);
    await speak(`${data.reply}${pending.length ? ` Tenho ${pending.length === 1 ? "uma proposta" : `${pending.length} propostas`}: ${pending.join(". ")}.` : ""}`);
    setSpeaking(false);
  };

  const save = React.useCallback(
    (c: Cached) => {
      setData(c);
      try {
        sessionStorage.setItem(key, JSON.stringify(c));
      } catch {}
    },
    [key],
  );

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await askAssistant({ scope: "company", companyId, mode: "insights" });
      save({ ...r, at: new Intl.DateTimeFormat("pt-PT", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date()) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "O assistente não respondeu.";
      if (msg.startsWith(NOT_ACTIVE)) setInactive(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [companyId, tz, save]);

  React.useEffect(() => {
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) return void setData(JSON.parse(cached) as Cached);
    } catch {}
    void run();
  }, [key, run]);

  if (inactive) return null;

  return (
    <section className="rounded-xl border border-border bg-background p-5 sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">Análise do assistente</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {data ? `Feita às ${data.at} com os dados da empresa. As acções só acontecem quando confirmar.` : "O assistente está a rever a assiduidade de hoje."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ttsOk && data ? (
            <Button size="sm" variant={speaking ? "primary" : "outline"} onClick={() => void listenSummary()} aria-pressed={speaking}>
              {speaking ? "Parar" : "Ouvir"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden /> : null}
            Actualizar
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/empresa/assistente/">Conversar ou falar</Link>
          </Button>
        </div>
      </div>
      <div className="mt-4 text-[14px] leading-relaxed">
        {error ? <p className="text-[13.5px] text-muted">{error}</p> : null}
        {!data && loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        ) : null}
        {data ? (
          <>
            <RichText text={data.reply} />
            <AiActions actions={data.actions} companyId={companyId} onChange={(actions: AiAction[]) => save({ ...data, actions })} />
          </>
        ) : null}
      </div>
    </section>
  );
}
