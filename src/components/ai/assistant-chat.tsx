"use client";

import { Microphone } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { AiActions, askAssistant, NOT_ACTIVE, type AiAction, type AiActionsHandle, type AiReply } from "@/components/ai/actions";
import { canListen, canSpeak, listen, speak, stopSpeaking, voiceCommand } from "@/components/ai/voice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { errorMessage, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "model"; text: string; actions?: AiAction[] };
type Conversation = { id: string; title: string; messages: Msg[]; updated_at: string };

export type AssistantScope = { kind: "company"; companyId: string } | { kind: "platform" };

/** Normaliza as mensagens guardadas (aceita também o formato antigo { role: "assistant", content }). */
function normalize(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const o = m as { role?: string; text?: string; content?: string; actions?: AiAction[] };
      const text = o.text ?? o.content ?? "";
      return { role: o.role === "user" ? "user" : "model", text, ...(Array.isArray(o.actions) && o.actions.length ? { actions: o.actions } : {}) } as Msg;
    })
    .filter((m) => m.text);
}

async function ask(scope: AssistantScope, messages: Msg[]): Promise<AiReply> {
  const history = messages.map((m) => ({ role: m.role, text: m.text }));
  return askAssistant(scope.kind === "company" ? { scope: "company", companyId: scope.companyId, messages: history } : { scope: "platform", messages: history });
}

/** Conversa com o assistente (empresa ou Super Admin), com histórico guardado por utilizador. */
export function AssistantChat({
  scope,
  userId,
  suggestions,
  intro,
}: {
  scope: AssistantScope;
  userId: string;
  suggestions: string[];
  intro: string;
}) {
  const companyId = scope.kind === "company" ? scope.companyId : null;
  const [cid, setCid] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [inactive, setInactive] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  // Refs para o ciclo de voz (que corre fora do ciclo de render).
  const messagesRef = React.useRef<Msg[]>([]);
  const cidRef = React.useRef<string | null>(null);
  messagesRef.current = messages;
  cidRef.current = cid;
  const actionsRef = React.useRef<AiActionsHandle>(null);
  const [voice, setVoice] = React.useState<"off" | "listening" | "thinking" | "speaking">("off");
  const [heard, setHeard] = React.useState("");
  const voiceOn = React.useRef(false);
  const stopListening = React.useRef<() => void>(() => {});
  const [readAloud, setReadAloud] = React.useState(false);
  const [voiceOk, setVoiceOk] = React.useState({ listen: false, speak: false });
  React.useEffect(() => {
    setVoiceOk({ listen: canListen(), speak: canSpeak() });
    try {
      setReadAloud(localStorage.getItem("horbit-ler-respostas") === "1");
    } catch {}
    return () => {
      voiceOn.current = false;
      stopListening.current();
      stopSpeaking();
    };
  }, []);

  const convs = useData(async () => {
    const base = sb().from("ai_conversations").select("id,title,messages,updated_at").eq("user_id", userId);
    const { data, error } = await (companyId ? base.eq("company_id", companyId) : base.is("company_id", null))
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) return [] as Conversation[]; // o histórico é opcional
    return (data ?? []).map((c) => ({ ...c, messages: normalize(c.messages) })) as Conversation[];
  }, [companyId, userId]);

  React.useEffect(() => {
    // Bloco sem retorno: em navegadores recentes scrollIntoView devolve uma Promise, que o React trataria como limpeza.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const open = (c: Conversation | null) => {
    if (busy) return;
    endVoice();
    setCid(c?.id ?? null);
    setMessages(c?.messages ?? []);
    setInput("");
  };

  async function persist(id: string | null, all: Msg[]): Promise<string | null> {
    const title = (all.find((m) => m.role === "user")?.text ?? "Conversa").slice(0, 80);
    try {
      if (id) {
        await sb().from("ai_conversations").update({ messages: all, updated_at: new Date().toISOString() }).eq("id", id);
        return id;
      }
      const { data } = await sb().from("ai_conversations").insert({ company_id: companyId, user_id: userId, title, messages: all }).select("id").single();
      return (data as { id: string } | null)?.id ?? null;
    } catch {
      return id;
    }
  }

  async function send(text: string, fromVoice = false): Promise<AiReply | null> {
    const t = text.trim();
    if (!t || busy) return null;
    const before = messagesRef.current;
    const next = [...before, { role: "user" as const, text: t }];
    messagesRef.current = next;
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const answer = await ask(scope, next);
      const all: Msg[] = [...next, { role: "model", text: answer.reply, ...(answer.actions.length ? { actions: answer.actions } : {}) }];
      messagesRef.current = all;
      setMessages(all);
      setInactive(false);
      const id = await persist(cidRef.current, all);
      if (id !== cidRef.current) {
        cidRef.current = id;
        setCid(id);
      }
      convs.reload();
      if (readAloud && !fromVoice) void speak(spoken(answer));
      return answer;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      if (msg.startsWith(NOT_ACTIVE)) setInactive(true);
      else toast.error(msg);
      messagesRef.current = before;
      setMessages(before);
      if (!fromVoice) setInput(t);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------ Voz ------------------------------ */
  function endVoice() {
    voiceOn.current = false;
    stopListening.current();
    stopSpeaking();
    setVoice("off");
    setHeard("");
  }

  async function say(text: string) {
    if (!voiceOn.current) return;
    setVoice("speaking");
    await speak(text);
  }

  /** Conversa por voz: ouve, responde em voz alta, confirma acções com "confirmar"/"ignorar", termina com "parar". */
  async function voiceLoop() {
    if (voiceOn.current) return endVoice();
    voiceOn.current = true;
    let silent = 0;
    while (voiceOn.current) {
      setVoice("listening");
      setHeard("");
      let text = "";
      try {
        const l = listen(setHeard);
        stopListening.current = l.stop;
        text = await l.result;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível ouvir.");
        break;
      }
      if (!voiceOn.current) break;
      if (!text) {
        if (++silent >= 2) break;
        continue;
      }
      silent = 0;
      const cmd = voiceCommand(text);
      const pending = actionsRef.current?.pending() ?? 0;
      if (cmd === "stop") {
        await say("Até já.");
        break;
      }
      if (cmd === "confirm" && pending) {
        setVoice("thinking");
        const r = await actionsRef.current!.confirmNext();
        const left = actionsRef.current?.pending() ?? 0;
        await say(`${r ?? "Feito."}${left ? ` Há mais ${left === 1 ? "uma acção" : `${left} acções`}. Diga confirmar ou ignorar.` : ""}`);
        continue;
      }
      if (cmd === "skip" && pending) {
        actionsRef.current!.skipNext();
        const left = actionsRef.current?.pending() ?? 0;
        await say(left ? `Ignorado. Há mais ${left === 1 ? "uma acção" : `${left} acções`}.` : "Ignorado.");
        continue;
      }
      setVoice("thinking");
      const answer = await send(text, true);
      if (answer) await say(spoken(answer));
    }
    endVoice();
  }

  const remove = async (c: Conversation) => {
    if (!window.confirm(`Apagar a conversa "${c.title}"?`)) return;
    const { error } = await sb().from("ai_conversations").delete().eq("id", c.id);
    if (error) return void toast.error(errorMessage(error));
    if (c.id === cid) open(null);
    convs.reload();
  };

  const list = convs.data ?? [];
  let lastWithActions = -1;
  messages.forEach((m, i) => {
    if (m.role === "model" && m.actions?.length) lastWithActions = i;
  });

  return (
    <>
      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-10 lg:py-7">
        {inactive ? <Notice tone="warning" title="Assistente desactivado">{NOT_ACTIVE}</Notice> : null}
        <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
          <aside className="min-w-0">
            <div className="flex items-center justify-between gap-3 lg:block">
              <h2 className="text-[15px] font-bold tracking-[-0.01em] lg:mb-3">Conversas</h2>
              <Button variant="outline" size="sm" className="lg:w-full" onClick={() => open(null)} disabled={busy}>
                Nova conversa
              </Button>
            </div>
            {list.length ? (
              <ul className="mt-3 flex gap-1 overflow-x-auto pb-1 scrollbar-none lg:mt-4 lg:block lg:space-y-0.5 lg:overflow-visible">
                {list.map((c) => (
                  <li key={c.id} className="group flex shrink-0 items-center gap-1 lg:shrink">
                    <button
                      type="button"
                      onClick={() => open(c)}
                      className={cn(
                        "flex max-w-56 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:max-w-none",
                        c.id === cid && "bg-surface-2 font-bold text-foreground",
                      )}
                    >
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="hidden shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-bold text-subtle hover:bg-danger-soft hover:text-danger group-hover:block focus-visible:block"
                    >
                      Apagar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 hidden text-[13px] text-muted lg:block">As conversas ficam guardadas aqui.</p>
            )}
          </aside>

          <section className="flex min-h-[calc(100dvh-16rem)] min-w-0 flex-col rounded-xl border border-border bg-background">
            <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" aria-live="polite">
              {messages.length === 0 ? (
                <div className="max-w-xl py-6 sm:py-10">
                  <p className="text-[22px] leading-tight font-bold tracking-[-0.02em]">Em que posso ajudar?</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                    {intro}
                  </p>
                  <p className="mt-7 text-[13px] font-bold">Pode começar por</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="cursor-pointer rounded-lg border border-border-strong bg-background px-3.5 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl px-4 py-3 text-[14px] leading-relaxed break-words sm:max-w-[75%]",
                        m.role === "user" ? "rounded-br-[8px] bg-foreground whitespace-pre-wrap text-background" : "rounded-bl-[8px] bg-surface-2 text-foreground",
                      )}
                    >
                      {m.role === "model" ? <RichText text={m.text} /> : m.text}
                      {m.role === "model" && m.actions?.length && companyId ? (
                        <AiActions
                          ref={i === lastWithActions ? actionsRef : undefined}
                          actions={m.actions}
                          companyId={companyId}
                          onChange={(acts) => {
                            const all = messagesRef.current.map((x, j) => (j === i ? { ...x, actions: acts } : x));
                            messagesRef.current = all;
                            setMessages(all);
                            void persist(cidRef.current, all);
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {busy ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2.5 rounded-xl rounded-bl-[8px] bg-surface-2 px-4 py-3 text-[13.5px] font-medium text-muted">
                    <span className="spinner" aria-hidden /> A escrever
                  </div>
                </div>
              ) : null}
              <div ref={end} />
            </div>
            {voice !== "off" ? (
              <div className="flex items-center gap-3 border-t border-border bg-primary-soft px-4 py-3" role="status" aria-live="polite">
                <span className={cn("size-3 shrink-0 rounded-full bg-primary", voice === "listening" && "animate-pulse")} aria-hidden />
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {voice === "listening"
                    ? heard || "A ouvir… diga o que precisa, \"confirmar\", \"ignorar\" ou \"parar\"."
                    : voice === "thinking"
                      ? `"${heard}"`
                      : "A falar…"}
                </p>
                <Button size="sm" variant="outline" onClick={endVoice}>
                  Parar voz
                </Button>
              </div>
            ) : null}
            <form
              className="flex items-end gap-2 border-t border-border p-3 sm:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Escreva uma mensagem"
                className="min-h-11 resize-none"
                rows={1}
                maxLength={4000}
                aria-label="Mensagem"
              />
              {voiceOk.listen ? (
                <Button
                  type="button"
                  variant={voice === "off" ? "outline" : "primary"}
                  className="shrink-0"
                  onClick={() => void voiceLoop()}
                  aria-pressed={voice !== "off"}
                  aria-label={voice === "off" ? "Falar com o assistente" : "Parar a conversa por voz"}
                >
                  <Microphone className="size-[18px]" weight={voice === "off" ? "regular" : "fill"} aria-hidden />
                  <span className="hidden sm:inline">{voice === "off" ? "Falar" : "Parar"}</span>
                </Button>
              ) : null}
              <Button type="submit" disabled={busy || !input.trim()} className="shrink-0">
                Enviar
              </Button>
            </form>
            {voiceOk.speak ? (
              <label className="flex cursor-pointer items-center gap-2.5 px-4 pb-3 text-[13px] text-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={readAloud}
                  onChange={(e) => {
                    setReadAloud(e.target.checked);
                    if (!e.target.checked) stopSpeaking();
                    try {
                      localStorage.setItem("horbit-ler-respostas", e.target.checked ? "1" : "0");
                    } catch {}
                  }}
                />
                Ler as respostas em voz alta
              </label>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}

/** O que o assistente diz em voz alta: a resposta e, se houver acções, como as confirmar. */
function spoken(a: AiReply) {
  if (!a.actions.length) return a.reply;
  const list = a.actions.map((x) => x.label).join(". ");
  const intro = /^(Preparei o seguinte|Proponho o seguinte)/.test(a.reply) ? "Preparei o seguinte" : `${a.reply} Preparei o seguinte`;
  return `${intro}: ${list}. Diga confirmar ou ignorar.`;
}

/** Formatação mínima e segura das respostas (negrito, código e listas), sem HTML arbitrário. */
export function RichText({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i} className="rounded-sm bg-background px-1.5 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>
      ) : (
        <span key={i}>{part.replace(/(^|\s)\*([^*]+)\*/g, "$1$2")}</span>
      ),
    );
  return (
    <>
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        const bullet = /^\s*[-*]\s+/.test(line);
        const numbered = /^\s*\d+\.\s+/.test(line);
        const heading = /^#{1,4}\s+/.test(line);
        if (!line.trim()) return <span key={i} className="block h-2" />;
        return (
          <span key={i} className={cn("block", (bullet || numbered) && "pl-4", /^\s{2,}/.test(raw) && "pl-8", heading && "mt-1 font-bold")}>
            {bullet ? <span className="mr-2 text-muted" aria-hidden>–</span> : null}
            {inline(bullet ? line.replace(/^\s*[-*]\s+/, "") : heading ? line.replace(/^#{1,4}\s+/, "") : line.trim())}
          </span>
        );
      })}
    </>
  );
}
