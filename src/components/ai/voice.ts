/**
 * Voz do assistente: reconhecimento de fala do navegador (Chrome, Edge, Safari, Samsung Internet) e
 * leitura em voz alta com a voz neural do Fish Audio (pelo OpenRouter) ou, em reserva, a do navegador.
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

/* ------------------------------- Voz escolhida ------------------------------- */

/** Voz do Orbi: feminina ou masculina. É sempre a mesma voz para cada uma. */
export type VoiceGender = "f" | "m";
const GENDER_KEY = "horbit-voz-orbi";

export function getVoiceGender(): VoiceGender {
  try {
    return localStorage.getItem(GENDER_KEY) === "m" ? "m" : "f";
  } catch {
    return "f";
  }
}

export function setVoiceGender(g: VoiceGender) {
  try {
    localStorage.setItem(GENDER_KEY, g);
  } catch {}
}

/* --------------------------------- Ouvir --------------------------------- */

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o acesso ao microfone nas definições do navegador.",
  "service-not-allowed": "Permita o acesso ao microfone nas definições do navegador.",
  "audio-capture": "Não foi encontrado nenhum microfone.",
  network: "Sem ligação à internet para reconhecer a voz.",
  "language-not-supported": "Este navegador não reconhece português.",
};

/** Junta os pedaços reconhecidos. Alguns telemóveis repetem a frase inteira em cada pedaço: aí substitui em vez de juntar. */
function joinPieces(pieces: string[]) {
  let out = "";
  for (const raw of pieces) {
    const p = raw.trim();
    if (!p) continue;
    const a = out.toLowerCase();
    const b = p.toLowerCase();
    if (b.startsWith(a)) out = p;
    else if (!a.endsWith(b)) out = `${out} ${p}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Ouve até a pessoa terminar de falar: só acaba depois de `silenceMs` sem falar (pausas curtas não cortam a frase).
 * Resolve com o texto ("" se não disse nada). `stop()` termina já e envia o que foi dito.
 */
export function listen(
  onInterim?: (text: string) => void,
  { silenceMs = 1900, noSpeechMs = 9000 }: { silenceMs?: number; noSpeechMs?: number } = {},
): { result: Promise<string>; stop: () => void } {
  const R = recognitionClass();
  if (!R) return { result: Promise.reject(new Error("Este navegador não suporta comandos de voz. Use o Chrome.")), stop: () => {} };
  let r = new R();
  let text = "";
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  let finish: () => void = () => {};

  const result = new Promise<string>((resolve, reject) => {
    finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        r.stop();
      } catch {}
      resolve(text.trim());
    };
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(finish, ms);
    };
    const setup = (rec: Recognition) => {
      rec.lang = "pt-PT";
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      let base = text; // o que já tinha sido dito antes de o navegador reiniciar o microfone
      rec.onresult = (e) => {
        const pieces: string[] = [];
        for (let i = 0; i < e.results.length; i++) pieces.push(e.results[i][0].transcript);
        text = joinPieces([base, ...pieces]);
        onInterim?.(text);
        if (text) arm(silenceMs);
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (text.trim()) return finish();
        done = true;
        clearTimeout(timer);
        reject(new Error(ERRORS[e.error] ?? "Não foi possível ouvir. Tente novamente."));
      };
      rec.onend = () => {
        if (done) return;
        // O navegador às vezes fecha o microfone sozinho: se a pessoa ainda pode estar a falar, volta a ouvir.
        if (Date.now() - started < 60_000 && (!text.trim() || timer)) {
          base = text;
          r = new R();
          setup(r);
          try {
            r.start();
            return;
          } catch {}
        }
        finish();
      };
    };
    setup(r);
    arm(noSpeechMs);
  });
  try {
    r.start();
  } catch {
    // já estava a ouvir
  }
  return { result, stop: () => finish() };
}

/* --------------------------------- Falar --------------------------------- */

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

const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Voz do navegador em português, se possível do género escolhido. */
function browserVoice(gender: VoiceGender) {
  const pt = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("pt"));
  const female = /female|mulher|feminin|joana|luciana|francisca|maria|raquel|fernanda|vit[oó]ria|helena|in[eê]s|catarina|leticia/i;
  const male = /\bmale\b|homem|masculin|duarte|daniel|ant[oó]nio|cristiano|ricardo|felipe|jo[aã]o|paulo/i;
  const wanted = pt.filter((v) => (gender === "f" ? female : male).test(v.name));
  return wanted.find((v) => v.lang === "pt-PT") ?? wanted[0] ?? pt.find((v) => v.lang === "pt-PT") ?? pt[0] ?? null;
}

const AI_FUNCTION = process.env.NEXT_PUBLIC_AI_FUNCTION ?? "Ponto-ai";
/** false quando a voz neural não está configurada no servidor: não volta a tentar nesta sessão. */
let neuralOk = true;
let current: { stop: () => void } | null = null;
let audioCtx: AudioContext | null = null;
/** Cada nova fala (ou stopSpeaking) invalida a anterior. */
let generation = 0;

/** Pede o áudio (MP3) de um pedaço à Edge Function. null se não houver voz neural. */
async function neuralAudio(text: string, gender: VoiceGender): Promise<Blob | null> {
  if (!neuralOk) return null;
  try {
    const { data } = await sb().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${AI_FUNCTION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ mode: "speak", text: text.slice(0, 1500), voice: gender }),
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
      resolve(ok);
    };
    current = {
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
function speakBrowser(text: string, gender: VoiceGender, onWord?: (strength?: number) => void): Promise<void> {
  if (!hasSynth()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = text.match(/[^.!?]+[.!?]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
  if (!parts.length) return Promise.resolve();
  const v = browserVoice(gender);
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

/** Fala que vai recebendo texto aos pedaços (streaming). */
export type Speaker = { push: (text: string) => void; end: () => void; done: Promise<void> };

/**
 * Cria um "falante": recebe o texto à medida que chega e fala frase a frase com a voz neural escolhida
 * (feminina ou masculina, sempre a mesma). A primeira frase começa logo, as seguintes são geradas enquanto fala.
 * Se a voz neural falhar, continua com a voz do navegador. onWord recebe a intensidade (0–1) da fala.
 */
export function createSpeaker(onWord?: (strength?: number) => void): Speaker {
  stopSpeaking();
  const my = ++generation;
  const gender = getVoiceGender();
  let buffer = "";
  let ended = false;
  const parts: string[] = [];
  const audio: Promise<Blob | null>[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const get = (i: number) => (i < parts.length && neuralOk ? (audio[i] ??= neuralAudio(parts[i], gender)) : null);

  /** Tira do buffer as frases completas (a primeira sozinha; depois blocos até ~170 caracteres). */
  const flush = (all: boolean) => {
    const re = /[^.!?\n]*[.!?\n]+(\s+|$)/g;
    let m: RegExpExecArray | null;
    let used = 0;
    const found: string[] = [];
    while ((m = re.exec(buffer)) && (all || m.index + m[0].length < buffer.length || /\s$/.test(m[0]))) {
      if (!m[0]) break;
      // Do fim da frase anterior até ao fim desta (não perde texto como "1.500" a meio).
      found.push(buffer.slice(used, m.index + m[0].length));
      used = m.index + m[0].length;
    }
    if (all && used < buffer.length) {
      found.push(buffer.slice(used));
      used = buffer.length;
    }
    buffer = buffer.slice(used);
    for (const f of found) {
      const t = plain(f);
      if (!t) continue;
      // A primeira frase longa é cortada na primeira vírgula ou dois pontos: o áudio começa mais cedo.
      if (!parts.length && t.length > 90) {
        const cut = /^(.{25,90}?[,:;])\s+(.+)$/.exec(t);
        if (cut) {
          parts.push(cut[1], cut[2]);
          continue;
        }
      }
      const last = parts.length > 1 ? parts[parts.length - 1] : null;
      // Junta frases curtas, mas só enquanto o áudio desse bloco ainda não foi pedido.
      if (last && last.length + t.length < 170 && audio[parts.length - 1] === undefined) parts[parts.length - 1] = `${last} ${t}`;
      else parts.push(t);
    }
    void get(0);
    void get(1);
    notify();
  };

  const done = (async () => {
    for (let i = 0; ; i++) {
      while (i >= parts.length) {
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
        if (my !== generation) return;
      }
      if (my !== generation) return;
      const pending = get(i);
      void get(i + 1);
      void get(i + 2);
      const blob = pending ? await pending : null;
      if (my !== generation) return;
      if (!blob || !(await playAudio(blob, onWord))) {
        if (my !== generation) return;
        await speakBrowser(parts[i], gender, onWord);
      }
      if (my !== generation) return;
    }
  })();

  return {
    push: (text) => {
      if (ended || my !== generation) return;
      buffer += text;
      flush(false);
    },
    end: () => {
      if (ended) return;
      flush(true);
      ended = true;
      notify();
    },
    done,
  };
}

/** Lê um texto inteiro em voz alta (mesma voz e mesmo processo frase a frase). */
export async function speak(text: string, onWord?: (strength?: number) => void): Promise<void> {
  const s = createSpeaker(onWord);
  s.push(text);
  s.end();
  await s.done;
}

export function stopSpeaking() {
  generation++;
  current?.stop();
  current = null;
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
