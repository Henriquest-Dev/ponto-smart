"use client";

import { Microphone, Paperclip, X } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { AiActions, askAssistant, NOT_ACTIVE, type AiAction, type AiActionsHandle, type AiReply } from "@/components/ai/actions";
import { OrbiEye } from "@/components/ai/orbi-eye";
import type { OrbiApi } from "@/components/ai/orbi";
import { ACCEPT, addAttachments, fileSize, type Attachment } from "@/components/ai/attachments";
import { canListen, canSpeak, listen, speak, stopSpeaking, voiceCommand } from "@/components/ai/voice";
import { VoiceStage, type VoiceStageHandle } from "@/components/ai/voice-stage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { errorMessage, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type FileRef = { name: string; mime: string };
/** hidden: mensagem interna (ex.: o pedido de saudação ao abrir a voz), não aparece no ecrã. */
type Msg = { role: "user" | "model"; text: string; actions?: AiAction[]; files?: FileRef[]; hidden?: boolean };
type Conversation = { id: string; title: string; messages: Msg[]; updated_at: string };

export type AssistantScope = { kind: "company"; companyId: string } | { kind: "platform" };

/** Normaliza as mensagens guardadas (aceita também o formato antigo { role: "assistant", content }). */
function normalize(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const o = m as { role?: string; text?: string; content?: string; actions?: AiAction[]; files?: FileRef[]; hidden?: boolean };
      const text = o.text ?? o.content ?? "";
      return {
        role: o.role === "user" ? "user" : "model",
        text,
        ...(Array.isArray(o.actions) && o.actions.length ? { actions: o.actions } : {}),
        ...(Array.isArray(o.files) && o.files.length ? { files: o.files } : {}),
        ...(o.hidden ? { hidden: true } : {}),
      } as Msg;
    })
    .filter((m) => m.text);
}

/** Envia a conversa. Os anexos vão só com a última mensagem: texto (planilhas, CSV) junto ao texto, imagens e PDF à parte. */
async function ask(scope: AssistantScope, messages: Msg[], files: Attachment[] = []): Promise<AiReply> {
  const history = messages.map((m, i) => {
    const last = i === messages.length - 1;
    const names = m.files?.length && !last ? `\n(anexou: ${m.files.map((f) => f.name).join(", ")})` : "";
    const texts = last ? files.filter((f) => f.text).map((f) => `\n\n[Anexo: ${f.name}]\n${f.text}`).join("") : "";
    const binary = last ? files.filter((f) => f.data).map((f) => ({ name: f.name, mime: f.mime, data: f.data })) : [];
    return { role: m.role, text: m.text + names + texts, ...(binary.length ? { files: binary } : {}) };
  });
  return askAssistant(scope.kind === "company" ? { scope: "company", companyId: scope.companyId, messages: history } : { scope: "platform", messages: history });
}

/** Pedido interno ao abrir a conversa por voz: o Orbi fala primeiro. */
const GREETING =
  "Abri agora a conversa por voz contigo. Cumprimenta-me com naturalidade e diz, em duas frases curtas, o que se passa neste momento na empresa (ou na plataforma). Depois pergunta em que posso ajudar. Sem listas.";

/** Conversa com o assistente (empresa ou Super Admin), com histórico guardado por utilizador. */
export function AssistantChat({
  scope,
  userId,
  suggestions,
  intro,
  autoVoice = false,
}: {
  scope: AssistantScope;
  userId: string;
  suggestions: string[];
  intro: string;
  /** Abrir logo a conversa por voz (vindo do olho flutuante). */
  autoVoice?: boolean;
}) {
  const companyId = scope.kind === "company" ? scope.companyId : null;
  const [cid, setCid] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [inactive, setInactive] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  const orbi = React.useRef<OrbiApi | null>(null);
  // Refs para o ciclo de voz (que corre fora do ciclo de render).
  const messagesRef = React.useRef<Msg[]>([]);
  const cidRef = React.useRef<string | null>(null);
  messagesRef.current = messages;
  cidRef.current = cid;
  const actionsRef = React.useRef<AiActionsHandle>(null);
  const [voice, setVoice] = React.useState<"off" | "idle" | "listening" | "thinking" | "speaking">("off");
  const stage = React.useRef<VoiceStageHandle>(null);
  const [needsStart, setNeedsStart] = React.useState(false);
  const [files, setFiles] = React.useState<Attachment[]>([]);
  const filesRef = React.useRef<Attachment[]>([]);
  filesRef.current = files;
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [lastReply, setLastReply] = React.useState("");
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

  // O Orbi olha para cada resposta nova e pisca.
  React.useEffect(() => {
    const lastIdx = messages.length - 1;
    if (lastIdx < 0 || messages[lastIdx].role !== "model") return;
    const el = document.querySelector(`[data-msg="${lastIdx}"]`);
    orbi.current?.lookAt(el);
    orbi.current?.blink();
  }, [messages]);

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
    const title = (all.find((m) => m.role === "user" && !m.hidden)?.text ?? "Conversa por voz").slice(0, 80);
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

  async function attach(list: FileList) {
    const r = await addAttachments(filesRef.current, list);
    filesRef.current = r.list;
    setFiles(r.list);
    r.errors.forEach((e) => toast.error(e));
  }

  async function send(text: string, fromVoice = false, opts: { hidden?: boolean } = {}): Promise<AiReply | null> {
    const sending = opts.hidden ? [] : filesRef.current;
    const t = text.trim() || (sending.length ? "Analisa o anexo." : "");
    if (!t || busy) return null;
    const before = messagesRef.current;
    const userMsg: Msg = {
      role: "user",
      text: t,
      ...(sending.length ? { files: sending.map((f) => ({ name: f.name, mime: f.mime })) } : {}),
      ...(opts.hidden ? { hidden: true } : {}),
    };
    const next = [...before, userMsg];
    messagesRef.current = next;
    setMessages(next);
    setInput("");
    if (sending.length) {
      filesRef.current = [];
      setFiles([]);
    }
    setBusy(true);
    try {
      const answer = await ask(scope, next, sending);
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
      if (sending.length) {
        filesRef.current = sending;
        setFiles(sending);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------ Voz ------------------------------ */
  /** Fecha o ecrã de voz. */
  function endVoice() {
    voiceOn.current = false;
    stopListening.current();
    stopSpeaking();
    setVoice("off");
    setHeard("");
    setNeedsStart(false);
  }

  /** Pausa (microfone desligado) mas mantém o ecrã de voz aberto. */
  function pauseVoice() {
    voiceOn.current = false;
    stopListening.current();
    stopSpeaking();
    setVoice("idle");
  }

  async function say(text: string) {
    if (!voiceOn.current) return;
    setVoice("speaking");
    setLastReply(text);
    await speak(text, (n) => stage.current?.kick(n ?? 0.8));
  }

  /** Abre o ecrã de voz; o Orbi fala primeiro e depois fica a ouvir. */
  function openVoice() {
    if (!voiceOk.listen) return void toast.error("Este navegador não suporta conversa por voz. Use o Chrome, o Edge ou o Safari.");
    setVoice("idle");
    setHeard("");
    setLastReply("");
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return setNeedsStart(true);
    void voiceLoop(true);
  }

  /** Conversa por voz: ouve, responde em voz alta, confirma acções com "confirmar"/"ignorar", termina com "parar". */
  async function voiceLoop(greet = false) {
    if (voiceOn.current) return;
    voiceOn.current = true;
    setNeedsStart(false);
    if (greet) {
      setVoice("thinking");
      const hello = await send(GREETING, true, { hidden: true });
      // Sem resposta (ex.: assistente sobrecarregado): cumprimenta na mesma.
      await say(hello ? spoken(hello) : "Olá! Estou a ouvir. Em que posso ajudar?");
    }
    let silent = 0;
    while (voiceOn.current) {
      setVoice("listening");
      setHeard("");
      let text = "";
      try {
        const l = listen((t) => {
          setHeard(t);
          stage.current?.kick(0.6);
        });
        stopListening.current = l.stop;
        text = await l.result;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível ouvir.");
        break;
      }
      if (!voiceOn.current) return;
      if (!text) {
        if (++silent >= 2) break;
        continue;
      }
      silent = 0;
      const cmd = voiceCommand(text);
      const pending = actionsRef.current?.pending() ?? 0;
      if (cmd === "stop") {
        await say("Até já.");
        voiceOn.current = false;
        return endVoice();
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
    // Silêncio ou erro: fica em pausa, com o ecrã aberto.
    if (voiceOn.current) pauseVoice();
  }

  // Vindo do olho flutuante: abre logo a voz.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (!autoVoice || autoOpened.current || !voiceOk.listen) return;
    autoOpened.current = true;
    // Tira ?voz=1 do endereço, para não reabrir ao recarregar.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    openVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVoice, voiceOk.listen]);

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
  const stageOpen = voice !== "off";
  const visible = messages.map((m, i) => ({ m, i })).filter(({ m }) => !m.hidden);
  const lastActionsMsg = lastWithActions >= 0 ? messages[lastWithActions] : null;
  const onActionsChange = (i: number) => (acts: AiAction[]) => {
    const all = messagesRef.current.map((x, j) => (j === i ? { ...x, actions: acts } : x));
    messagesRef.current = all;
    setMessages(all);
    void persist(cidRef.current, all);
  };

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
              {visible.length === 0 ? (
                <div className="mx-auto max-w-xl py-4 sm:py-8">
                  <div className="mb-5 flex justify-center">
                    <OrbiEye ref={orbi} size={128} thinking={busy || voice === "thinking"} />
                  </div>
                  <p className="text-center text-[22px] leading-tight font-bold tracking-[-0.02em]">Em que posso ajudar?</p>
                  <p className="mt-2 text-center text-[13.5px] leading-relaxed text-muted">
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
                <>
                <div className="sticky top-0 z-10 -mt-1 flex justify-center pb-1">
                  <span className="rounded-full bg-background/90 p-1 backdrop-blur">
                    <OrbiEye ref={orbi} size={56} thinking={busy || voice === "thinking"} />
                  </span>
                </div>
                {visible.map(({ m, i }) => (
                  <div key={i} data-msg={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl px-4 py-3 text-[14px] leading-relaxed break-words sm:max-w-[75%]",
                        m.role === "user" ? "rounded-br-[8px] bg-foreground whitespace-pre-wrap text-background" : "rounded-bl-[8px] bg-surface-2 text-foreground",
                      )}
                    >
                      {m.role === "model" ? <RichText text={m.text} /> : m.text}
                      {m.files?.length ? (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {m.files.map((f, k) => (
                            <span key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/15 px-2 py-1 text-[12px] font-medium">
                              <Paperclip className="size-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{f.name}</span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {m.role === "model" && m.actions?.length && companyId ? (
                        <AiActions
                          ref={i === lastWithActions && !stageOpen ? actionsRef : undefined}
                          actions={m.actions}
                          companyId={companyId}
                          onChange={onActionsChange(i)}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
                </>
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
            {files.length ? (
              <ul className="flex flex-wrap gap-2 border-t border-border px-3 pt-3 sm:px-4">
                {files.map((f, k) => (
                  <li key={`${f.name}-${k}`} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-2.5 text-[12.5px]">
                    <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="max-w-[200px] truncate font-medium">{f.name}</span>
                    <span className="text-subtle">{fileSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((cur) => (filesRef.current = cur.filter((_, j) => j !== k)))}
                      className="flex size-6 items-center justify-center rounded-md hover:bg-background"
                      aria-label={`Remover ${f.name}`}
                    >
                      <X className="size-3.5" weight="bold" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="flex items-end gap-2 border-t border-border p-3 sm:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <Button
                type="button"
                variant="ghost"
                className="shrink-0 px-2.5"
                onClick={() => fileInput.current?.click()}
                aria-label="Anexar ficheiro"
                title="Anexar imagem, PDF ou planilha"
              >
                <Paperclip className="size-[18px]" aria-hidden />
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void attach(e.target.files);
                  e.target.value = "";
                }}
              />
              <Textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  orbi.current?.follow(e.currentTarget);
                }}
                onFocus={(e) => orbi.current?.follow(e.currentTarget)}
                onBlur={() => orbi.current?.follow(null)}
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
                  variant="outline"
                  className="shrink-0"
                  onClick={openVoice}
                  aria-label="Falar com o assistente"
                >
                  <Microphone className="size-[18px]" aria-hidden />
                  <span className="hidden sm:inline">Falar</span>
                </Button>
              ) : null}
              <Button type="submit" disabled={busy || (!input.trim() && !files.length)} className="shrink-0">
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
      {stageOpen ? (
        <VoiceStage
          ref={stage}
          state={voice}
          caption={voice === "listening" || voice === "thinking" ? heard : lastReply}
          actions={
            lastActionsMsg?.actions?.some((a) => !a.state) && companyId ? (
              <AiActions ref={actionsRef} actions={lastActionsMsg.actions} companyId={companyId} onChange={onActionsChange(lastWithActions)} />
            ) : undefined
          }
          attachments={files}
          onAttach={(l) => void attach(l)}
          onRemoveAttachment={(k) => setFiles((cur) => (filesRef.current = cur.filter((_, j) => j !== k)))}
          onToggleMic={() => (voice === "idle" ? void voiceLoop(false) : pauseVoice())}
          onClose={endVoice}
          needsStart={needsStart}
          onStart={() => void voiceLoop(true)}
        />
      ) : null}
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
