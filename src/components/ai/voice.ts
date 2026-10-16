/**
 * Voz do assistente, com o que o próprio navegador oferece (sem custos):
 * reconhecimento de fala (Chrome, Edge, Safari, Samsung Internet) e leitura em voz alta (todos).
 */

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
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

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

/** Lê o texto em voz alta (em partes curtas: alguns telemóveis cortam frases longas). Resolve quando acaba.
 *  onWord é chamado a cada palavra dita (para animar o olho e o fundo). */
export function speak(text: string, onWord?: () => void): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
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

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
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
