"use client";

import { Microphone, MicrophoneSlash, Paperclip, X } from "@phosphor-icons/react";
import * as React from "react";
import { ACCEPT, type Attachment } from "@/components/ai/attachments";
import type { OrbiApi } from "@/components/ai/orbi";
import { OrbiEye } from "@/components/ai/orbi-eye";
import { cn } from "@/lib/utils";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type VoiceStageHandle = { kick: (strength?: number) => void };

/** Legenda sem marcas de formatação (negrito, código, listas). */
const plainCaption = (t: string) => t.replace(/\*\*|`|#+\s/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/\n+/g, " ").trim();

const LABEL: Record<VoiceState, string> = {
  idle: "Em pausa",
  listening: "A ouvir",
  thinking: "A pensar",
  speaking: "A falar",
};

/**
 * Conversa por voz em ecrã inteiro: só o olho do Orbi sobre um degradê que respira.
 * A ouvir, o fundo pulsa com as palavras que ouve; a falar, o olho mexe-se e pisca ao ritmo das palavras.
 */
export const VoiceStage = React.forwardRef<
  VoiceStageHandle,
  {
    state: VoiceState;
    /** O que a pessoa está a dizer (ao vivo) ou a última resposta. */
    caption: string;
    /** Acções por confirmar (Confirmar / Ignorar), já desenhadas. */
    actions?: React.ReactNode;
    attachments: Attachment[];
    onAttach: (files: FileList) => void;
    onRemoveAttachment: (i: number) => void;
    onToggleMic: () => void;
    onClose: () => void;
    /** O navegador ainda não deixa falar sem um toque: mostra "Começar". */
    needsStart?: boolean;
    onStart?: () => void;
  }
>(function VoiceStage({ state, caption, actions, attachments, onAttach, onRemoveAttachment, onToggleMic, onClose, needsStart, onStart }, ref) {
  const root = React.useRef<HTMLDivElement>(null);
  const eye = React.useRef<OrbiApi | null>(null);
  const level = React.useRef(0);
  const file = React.useRef<HTMLInputElement>(null);

  // O olho acompanha o estado da conversa.
  React.useEffect(() => {
    eye.current?.setThinking(state === "thinking");
    eye.current?.setListening(state === "listening");
    eye.current?.setTalking(state === "speaking");
    if (state === "speaking" || state === "listening") eye.current?.blink();
  }, [state]);

  // Nível de "energia" (palavras ouvidas ou ditas) que faz o degradê pulsar; decai sozinho.
  React.useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      level.current = Math.max(0, level.current - dt * 1.8);
      root.current?.style.setProperty("--lvl", level.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  React.useImperativeHandle(ref, () => ({
    kick: (strength = 1) => {
      level.current = Math.min(1, level.current + 0.45 * strength);
      eye.current?.kick(strength);
    },
  }));

  // Esc fecha; o resto da página não mexe por baixo.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const breath = state === "speaking" ? "1.1s" : state === "listening" ? "1.7s" : state === "thinking" ? "3.2s" : "4.5s";

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Conversa por voz com o Orbi"
      className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#0c0820] text-white"
      style={{ ["--breath" as string]: breath }}
    >
      {/* Degradê de fundo, em movimento lento. */}
      <div className="pointer-events-none absolute -inset-1/4 opacity-90" aria-hidden>
        <div
          className="orbi-drift absolute inset-0"
          style={{
            background:
              "radial-gradient(40% 35% at 30% 30%, rgb(124 58 237 / 0.55), transparent 70%), radial-gradient(35% 40% at 72% 68%, rgb(79 70 229 / 0.5), transparent 70%), radial-gradient(30% 30% at 70% 25%, rgb(192 38 211 / 0.28), transparent 70%)",
          }}
        />
      </div>

      <div className="relative flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-[15px] font-bold tracking-[-0.01em]">Orbi</p>
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Fechar a conversa por voz"
        >
          <X className="size-5" weight="bold" aria-hidden />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="relative flex size-[300px] items-center justify-center sm:size-[360px]">
          <div className="orbi-glow size-[340px] bg-[radial-gradient(circle,rgb(167_139_250)_0%,rgb(124_58_237/0.85)_32%,rgb(79_70_229/0.45)_55%,transparent_72%)] sm:size-[400px]" aria-hidden />
          <div className="orbi-glow size-[230px] bg-[radial-gradient(circle,rgb(232_121_249/0.55),transparent_68%)] mix-blend-screen sm:size-[270px]" style={{ animationDelay: "-0.6s" }} aria-hidden />
          {state === "listening" ? (
            <div aria-hidden>
              {[0, 0.8, 1.6].map((d) => (
                <span key={d} className="orbi-ripple size-[220px] sm:size-[260px]" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          ) : null}
          <OrbiEye ref={eye} size={190} label="" className="relative" />
        </div>

        <p className="mt-2 text-[13px] font-bold tracking-[0.02em] text-violet-200" aria-live="polite">
          {LABEL[state]}
          {state !== "idle" ? <span className="animate-pulse">…</span> : null}
        </p>
        <p className="mt-3 line-clamp-4 max-w-xl text-center text-[18px] leading-snug font-medium text-white/90 sm:text-[20px]">
          {plainCaption(caption) || (state === "listening" ? "Diga o que precisa." : state === "idle" ? "Toque no microfone para continuar." : "")}
        </p>

        {actions ? <div className="mt-5 max-h-[34dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-3 text-foreground shadow-xl">{actions}</div> : null}

        {needsStart ? (
          <button
            type="button"
            onClick={onStart}
            className="mt-6 h-12 rounded-full bg-white px-7 text-[15px] font-bold text-[#2c1678] shadow-lg transition-transform hover:scale-105"
          >
            Começar a conversa
          </button>
        ) : null}
      </div>

      {attachments.length ? (
        <ul className="relative mx-auto flex max-w-xl flex-wrap justify-center gap-2 px-5">
          {attachments.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-full bg-white/12 py-1.5 pr-1.5 pl-3 text-[12.5px]">
              <span className="max-w-[180px] truncate">{a.name}</span>
              <button type="button" onClick={() => onRemoveAttachment(i)} className="flex size-6 items-center justify-center rounded-full hover:bg-white/20" aria-label={`Remover ${a.name}`}>
                <X className="size-3.5" weight="bold" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative flex items-center justify-center gap-6 px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="flex size-12 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          aria-label="Anexar ficheiro"
          title="Anexar ficheiro"
        >
          <Paperclip className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleMic}
          className={cn(
            "flex size-[72px] items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105",
            state === "idle" ? "bg-white text-[#2c1678]" : "bg-white/15 text-white ring-2 ring-white/40",
          )}
          aria-label={state === "idle" ? "Falar" : "Pausar o microfone"}
        >
          {state === "idle" ? <Microphone className="size-8" weight="fill" aria-hidden /> : <MicrophoneSlash className="size-8" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 items-center justify-center rounded-full bg-white/10 px-4 text-[13px] font-bold transition-colors hover:bg-white/20"
        >
          Escrever
        </button>
        <input
          ref={file}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAttach(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
});
