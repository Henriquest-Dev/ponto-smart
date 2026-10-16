/**
 * Voz do assistente, com o que o próprio navegador oferece (sem custos):
 * reconhecimento de fala (Chrome, Edge, Safari, Samsung Internet) e leitura em voz alta (todos).
 */

import { sb, SUPABASE_KEY, SUPABASE_URL } from "@/lib/sb/client";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => !!recognitionClass();
export const canSpeak = () => typeof window !== "undefined" && ("speechSynthesis" in window || "Audio" in window);

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o acesso ao microfone nas definições do navegador.",
  "service-not-allowed": "Permita o acesso ao microfone nas definições do navegador.",
  "audio-capture": "Não foi encontrado nenhum microfone.",
  network: "Sem ligação à internet para reconhecer a voz.",
  "language-not-supported": "Este navegador não reconhece português.",
};

/** Ouve uma frase. Resolve com o texto (vazio se a pessoa não disse nada). */
export function listen(onInterim?: (text: string) => void): { result: Promise<string>; stop: () => void } {
  const R = recognitionClass();
  if (!R) return { result: Promise.reject(new Error("Este navegador não suporta comandos de voz. Use o Chrome.")), stop: () => {} };
  const r = new R();
  r.lang = "pt-PT";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let final = "";
  const result = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      onInterim?.((final + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      reject(new Error(ERRORS[e.error] ?? "Não foi possível ouvir. Tente novamente."));
    };
    r.onend = () => resolve(final.trim());
  });
  try {
    r.start();
  } catch {
    // já estava a ouvir
  }
  return { result, stop: () => r.stop() };
}

/** Texto limpo para ler: sem marcas de formatação nem listas. */
function plain(text: string) {
  return text
    .replace(/\*\*|`|#+\s/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/(\d{2})\/(\d{2})/g, "$1 do $2")
    .replace(/\bMZN\b/g, "meticais")
    .replace(/\n+/g, ". ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function voice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "pt-PT") ?? voices.find((v) => v.lang.startsWith("pt-PT")) ?? voices.find((v) => v.lang.startsWith("pt")) ?? null;
}

/* ---------------- Voz neural (Fish Audio pelo OpenRouter, através da Edge Function) ---------------- */

const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";
/** false quando a voz neural não está configurada no servidor: não volta a tentar nesta sessão. */
let neuralOk = true;
let current: { audio: HTMLAudioElement; stop: () => void } | null = null;
let audioCtx: AudioContext | null = null;

/** Pede o áudio (MP3) à Edge Function. null se não houver voz neural (usa-se a do navegador). */
async function neuralAudio(text: string): Promise<Blob | null> {
  if (!neuralOk) return null;
  try {
    const { data } = await sb().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${AI_FUNCTION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ mode: "speak", text: text.slice(0, 1500) }),
    });
    if (res.status === 501 || res.status === 400) neuralOk = false; // sem chave do OpenRouter ou função antiga
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Toca o MP3 e chama onLevel com o volume (0–1) várias vezes por segundo, para animar o olho. */
function playAudio(blob: Blob, onLevel?: (v: number) => void): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let raf = 0;
  let done = false;
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(url);
      if (current?.audio === audio) current = null;
      resolve(ok);
    };
    current = {
      audio,
      stop: () => {
        audio.pause();
        finish(true);
      },
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    if (onLevel) {
      try {
        audioCtx ??= new AudioContext();
        void audioCtx.resume();
        const src = audioCtx.createMediaElementSource(audio);
        const an = audioCtx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        an.connect(audioCtx.destination);
        const buf = new Uint8Array(an.fftSize);
        let last = 0;
        const tick = (t: number) => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / buf.length);
          if (t - last > 110 && rms > 0.04) {
            last = t;
            onLevel(Math.min(1, rms * 4));
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // sem Web Audio: toca na mesma, sem animação pelo volume
      }
    }
    audio.play().catch(() => finish(false));
  });
}

/** Voz do próprio navegador (reserva). */
const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;

function speakBrowser(text: string, onWord?: (strength?: number) => void): Promise<void> {
  if (!hasSynth()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = plain(text).match(/[^.!?]+[.!?]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
  if (!parts.length) return Promise.resolve();
  const v = voice();
  return new Promise((resolve) => {
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = v?.lang ?? "pt-PT";
      if (v) u.voice = v;
      u.rate = 1.05;
      if (onWord) {
        u.onboundary = (e) => {
          if (e.name === "word" || !e.name) onWord();
        };
        u.onstart = () => onWord();
      }
      if (i === parts.length - 1) {
        u.onend = () => resolve();
        u.onerror = () => resolve();
      }
      synth.speak(u);
    });
  });
}

/** Lê o texto em voz alta com a voz neural (Fish Audio); se não estiver disponível, com a voz do navegador.
 *  Resolve quando acaba. onWord recebe a intensidade (0–1) da fala, para animar o olho e o fundo. */
export async function speak(text: string, onWord?: (strength?: number) => void): Promise<void> {
  stopSpeaking();
  const clean = plain(text);
  if (!clean) return;
  const blob = await neuralAudio(clean);
  if (blob && (await playAudio(blob, onWord))) return;
  await speakBrowser(clean, onWord);
}

export function stopSpeaking() {
  current?.stop();
  if (hasSynth()) window.speechSynthesis.cancel();
}

/** Comandos de voz curtos para as acções propostas. */
export function voiceCommand(text: string): "confirm" | "skip" | "stop" | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
  if (/^(sim|confirmar|confirmo|confirma|confirmado|pode avancar|pode confirmar|avanca|avancar|ok|esta bem|faz isso|faca isso|pode fazer)( por favor)?$/.test(t)) return "confirm";
  if (/^(nao|ignorar|ignora|ignore|cancelar|cancela|nao faz isso|nao facas isso)( por favor)?$/.test(t)) return "skip";
  if (/^(parar|para|terminar|sair|desligar|desliga|chega|obrigad[oa]|e tudo)( obrigad[oa])?$/.test(t)) return "stop";
  return null;
}
