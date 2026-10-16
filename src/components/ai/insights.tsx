"use client";

import { ArrowClockwise, ChatCircleDots, PhoneCall, SpeakerHigh, Stop } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import { AiActions, askAssistant, NOT_ACTIVE, type AiAction, type AiReply } from "@/components/ai/actions";
import { RichText } from "@/components/ai/assistant-chat";
import { OrbiVideo } from "@/components/ai/orbi-eye";
import { canSpeak, speak, stopSpeaking } from "@/components/ai/voice";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

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

  const iconBtn =
    "flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40";
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background" aria-live="polite">
      <div className="flex items-center gap-3 border-b border-border bg-[linear-gradient(110deg,rgb(103_63_236/0.08),transparent_60%)] px-4 py-3 sm:px-5">
        <OrbiVideo size={40} className="shrink-0" label="" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-tight font-bold">Orbi</h2>
          <p className="truncate text-[12.5px] text-muted">{data ? `Análise de hoje, ${data.at}` : loading ? "A analisar…" : "Análise de hoje"}</p>
        </div>
        {ttsOk && data ? (
          <button
            type="button"
            className={cn(iconBtn, speaking && "bg-primary-soft text-primary")}
            onClick={() => void listenSummary()}
            aria-pressed={speaking}
            aria-label={speaking ? "Parar de ouvir" : "Ouvir a análise"}
            title={speaking ? "Parar" : "Ouvir"}
          >
            {speaking ? <Stop className="size-[18px]" weight="fill" aria-hidden /> : <SpeakerHigh className="size-[18px]" aria-hidden />}
          </button>
        ) : null}
        <button type="button" className={iconBtn} onClick={() => void run()} disabled={loading} aria-label="Actualizar a análise" title="Actualizar">
          <ArrowClockwise className={cn("size-[18px]", loading && "animate-spin")} aria-hidden />
        </button>
        <Link
          href="/empresa/assistente/?voz=1"
          className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-[13px] font-bold text-white transition-colors hover:bg-primary-hover"
          aria-label="Chamada de voz com o Orbi"
        >
          <PhoneCall className="size-4" weight="fill" aria-hidden />
          <span className="hidden sm:inline">Chamada</span>
        </Link>
      </div>
      <div className="px-4 py-4 text-[14.5px] leading-relaxed sm:px-5">
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
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-[12.5px] text-muted">
          <span>As acções só acontecem quando confirmar.</span>
          <Link href="/empresa/assistente/" className="inline-flex items-center gap-1.5 font-bold text-primary hover:underline">
            <ChatCircleDots className="size-4" aria-hidden />
            Conversar
          </Link>
        </div>
      </div>
    </section>
  );
}
