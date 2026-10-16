"use client";

import { ArrowUp, Brain, List, NotePencil, Paperclip, PhoneCall, SpeakerHigh, SpeakerSlash, Waveform, X } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { AI_FUNCTION, AiActions, askAssistant, NOT_ACTIVE, type AiAction, type AiActionsHandle, type AiReply } from "@/components/ai/actions";
import { ACCEPT, addAttachments, fileSize, type Attachment } from "@/components/ai/attachments";
import { ChatHistory, MemoryDialog, OrbiMark, type ConversationItem } from "@/components/ai/chat-parts";
import type { OrbiApi } from "@/components/ai/orbi";
import { OrbiEye } from "@/components/ai/orbi-eye";
import { canListen, canSpeak, listen, speak, stopSpeaking, voiceCommand } from "@/components/ai/voice";
import { VoiceStage, type VoiceStageHandle } from "@/components/ai/voice-stage";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/misc";
import { errorMessage, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type FileRef = { name: string; mime: string };
/** hidden: mensagem interna (ex.: o pedido de saudação ao abrir a voz), não aparece no ecrã. */
type Msg = { role: "user" | "model"; text: string; actions?: AiAction[]; files?: FileRef[]; hidden?: boolean };

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

/** Pedidos explícitos para lembrar algo: a memória é actualizada logo a seguir. */
const REMEMBER = /lembr[ae]|memoriz|n[aã]o te esque[cç]|guarda (isso|isto)|anota/i;

/** Conversa com o Orbi (empresa ou Super Admin): histórico de todas as conversas, memória, anexos e chamada de voz. */
export function AssistantChat({
  scope,
  userId,
  userName,
  suggestions,
  intro,
  autoVoice = false,
}: {
  scope: AssistantScope;
  userId: string;
  userName?: string;
  suggestions: string[];
  intro: string;
  /** Abrir logo a chamada de voz (vindo do olho flutuante). */
  autoVoice?: boolean;
}) {
  const companyId = scope.kind === "company" ? scope.companyId : null;
  const [cid, setCid] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [inactive, setInactive] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const eyeTop = React.useRef<OrbiApi | null>(null);
  const eyeBig = React.useRef<OrbiApi | null>(null);
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

  // Histórico: todas as conversas (só títulos; as mensagens carregam ao abrir).
  const convs = useData(async () => {
    const base = sb().from("ai_conversations").select("id,title,updated_at").eq("user_id", userId);
    const { data, error } = await (companyId ? base.eq("company_id", companyId) : base.is("company_id", null))
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) return [] as ConversationItem[]; // o histórico é opcional
    return (data ?? []) as ConversationItem[];
  }, [companyId, userId]);

  const eyes = (fn: (o: OrbiApi) => void) => {
    if (eyeTop.current) fn(eyeTop.current);
    if (eyeBig.current) fn(eyeBig.current);
  };

  // O Orbi olha para cada resposta nova e pisca.
  React.useEffect(() => {
    const lastIdx = messages.length - 1;
    if (lastIdx < 0 || messages[lastIdx].role !== "model") return;
    const el = document.querySelector(`[data-msg="${lastIdx}"]`);
    eyes((o) => {
      o.lookAt(el);
      o.blink();
    });
  }, [messages]);

  React.useEffect(() => {
    // Bloco sem retorno: em navegadores recentes scrollIntoView devolve uma Promise, que o React trataria como limpeza.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // A caixa de mensagem cresce com o texto (até 7 linhas).
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  /** Actualiza a memória do Orbi com os factos desta conversa (em segundo plano). */
  async function memorize(all: Msg[], explicit: string | null) {
    const history = all.filter((m) => !m.hidden).map((m) => ({ role: m.role, text: m.text }));
    if (history.length < 2) return;
    try {
      const { data } = await sb().functions.invoke(AI_FUNCTION, {
        body: { mode: "memorize", scope: scope.kind, ...(companyId ? { companyId } : {}), messages: history, ...(explicit ? { explicit } : {}) },
      });
      if (explicit && (data as { saved?: number } | null)?.saved) toast.success("Guardado na memória do Orbi.");
    } catch {
      // a memória é opcional
    }
  }

  const open = async (c: ConversationItem | null) => {
    if (busy) return;
    endVoice();
    setHistoryOpen(false);
    setInput("");
    if (!c) {
      setCid(null);
      setMessages([]);
      return;
    }
    setCid(c.id);
    setOpening(true);
    const { data, error } = await sb().from("ai_conversations").select("messages").eq("id", c.id).maybeSingle();
    setOpening(false);
    if (error) return void toast.error(errorMessage(error));
    setMessages(normalize((data as { messages?: unknown } | null)?.messages));
  };

  async function persist(id: string | null, all: Msg[]): Promise<string | null> {
    const title = (all.find((m) => m.role === "user" && !m.hidden)?.text ?? "Chamada de voz").slice(0, 80);
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
      // Memória: logo quando a pessoa pede para lembrar; senão, de 6 em 6 mensagens.
      const explicit = !opts.hidden && REMEMBER.test(t) ? t : null;
      if (explicit || (!opts.hidden && all.filter((m) => !m.hidden).length % 6 === 0)) void memorize(all, explicit);
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

  const remove = async (c: ConversationItem) => {
    if (!window.confirm(`Apagar a conversa "${c.title}"?`)) return;
    const { error } = await sb().from("ai_conversations").delete().eq("id", c.id);
    if (error) return void toast.error(errorMessage(error));
    if (c.id === cid) void open(null);
    convs.reload();
  };

  const rename = async (c: ConversationItem, title: string) => {
    const { error } = await sb().from("ai_conversations").update({ title }).eq("id", c.id);
    if (error) return void toast.error(errorMessage(error));
    convs.reload();
  };

  const toggleRead = () => {
    const v = !readAloud;
    setReadAloud(v);
    if (!v) stopSpeaking();
    try {
      localStorage.setItem("horbit-ler-respostas", v ? "1" : "0");
    } catch {}
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
  const title = cid ? (list.find((c) => c.id === cid)?.title ?? "Conversa") : "Nova conversa";
  const first = userName?.trim().split(/\s+/)[0];
  const thinking = busy || voice === "thinking";
  const canSend = !busy && (!!input.trim() || files.length > 0);

  const history = (
    <ChatHistory list={list} loading={convs.loading} activeId={cid} onOpen={(c) => void open(c)} onRename={(c, t) => void rename(c, t)} onDelete={(c) => void remove(c)} />
  );
  const memoryButton = (
    <button
      type="button"
      className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <Brain className="size-4" aria-hidden />
      Memória do Orbi
    </button>
  );

  return (
    <>
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 bg-background lg:h-dvh">
        {/* Histórico (computador) */}
        <aside className="hidden w-[280px] shrink-0 flex-col border-r border-border bg-surface/60 lg:flex">
          <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
            <OrbiMark className="size-8" />
            <div className="min-w-0">
              <p className="text-[15px] leading-tight font-bold">Orbi</p>
              <p className="text-[12px] text-muted">{scope.kind === "company" ? "Gestor de RH" : "Assistente da plataforma"}</p>
            </div>
          </div>
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => void open(null)}
              disabled={busy}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 text-[13.5px] font-bold shadow-[0_1px_2px_rgb(30_20_80/0.06)] transition-colors hover:bg-surface-2"
            >
              <NotePencil className="size-[18px]" aria-hidden />
              Nova conversa
            </button>
          </div>
          {history}
          <div className="border-t border-border p-2">
            <MemoryDialog companyId={companyId} trigger={memoryButton} />
          </div>
        </aside>

        {/* Conversa */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground lg:hidden"
              aria-label="Histórico de conversas"
            >
              <List className="size-5" aria-hidden />
            </button>
            <OrbiEye ref={eyeTop} size={30} thinking={thinking} label="" />
            <p className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{title}</p>
            {voiceOk.speak ? (
              <button
                type="button"
                onClick={toggleRead}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-2",
                  readAloud ? "text-primary" : "text-muted hover:text-foreground",
                )}
                aria-pressed={readAloud}
                aria-label={readAloud ? "Deixar de ler as respostas em voz alta" : "Ler as respostas em voz alta"}
                title={readAloud ? "Respostas em voz alta: ligado" : "Respostas em voz alta: desligado"}
              >
                {readAloud ? <SpeakerHigh className="size-5" aria-hidden /> : <SpeakerSlash className="size-5" aria-hidden />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void open(null)}
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground lg:hidden"
              aria-label="Nova conversa"
            >
              <NotePencil className="size-5" aria-hidden />
            </button>
            {voiceOk.listen ? (
              <button
                type="button"
                onClick={openVoice}
                className="flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-[13px] font-bold text-white shadow-[0_6px_16px_-6px_rgb(103_63_236/0.7)] transition-colors hover:bg-primary-hover"
                aria-label="Iniciar chamada de voz com o Orbi"
              >
                <PhoneCall className="size-4" weight="fill" aria-hidden />
                <span className="hidden sm:inline">Chamada</span>
              </button>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
              {inactive ? (
                <Notice tone="warning" title="Assistente desactivado" className="mb-4">
                  {NOT_ACTIVE}
                </Notice>
              ) : null}
              {opening ? <p className="py-10 text-center text-[13.5px] text-muted">A abrir a conversa…</p> : null}
              {!opening && visible.length === 0 ? (
                <div className="flex flex-col items-center pt-4 text-center sm:pt-10">
                  <OrbiEye ref={eyeBig} size={112} thinking={thinking} />
                  <h2 className="mt-5 text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]">
                    {first ? `Olá, ${first}.` : "Olá."} Em que posso ajudar?
                  </h2>
                  <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-muted">{intro}</p>
                  <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-2xl border border-border bg-background px-4 py-3.5 text-left text-[13.5px] leading-snug font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {!opening ? (
                <div className="space-y-6">
                  {visible.map(({ m, i }) =>
                    m.role === "user" ? (
                      <div key={i} data-msg={i} className="flex justify-end">
                        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-primary-soft px-4 py-2.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
                          {m.text}
                          {m.files?.length ? (
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              {m.files.map((f, k) => (
                                <span key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-[12px] font-medium">
                                  <Paperclip className="size-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">{f.name}</span>
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div key={i} data-msg={i} className="flex gap-3">
                        <OrbiMark className="mt-0.5" />
                        <div className="min-w-0 flex-1 text-[14.5px] leading-relaxed break-words text-foreground">
                          <RichText text={m.text} />
                          {m.actions?.length && companyId ? (
                            <AiActions
                              ref={i === lastWithActions && !stageOpen ? actionsRef : undefined}
                              actions={m.actions}
                              companyId={companyId}
                              onChange={onActionsChange(i)}
                            />
                          ) : null}
                        </div>
                      </div>
                    ),
                  )}
                  {busy && voice === "off" ? (
                    <div className="flex items-center gap-3">
                      <OrbiMark />
                      <span className="flex gap-1" aria-label="O Orbi está a escrever">
                        {[0, 1, 2].map((d) => (
                          <span key={d} className="size-2 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: `${d * 0.15}s` }} />
                        ))}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div ref={end} />
            </div>
          </div>

          {/* Caixa de mensagem */}
          <div className="shrink-0 px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-5">
            <form
              className="mx-auto w-full max-w-3xl rounded-[26px] border border-border bg-background p-2 shadow-[0_10px_30px_-14px_rgb(30_20_80/0.35)] transition-colors focus-within:border-primary/50"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSend) void send(input);
              }}
            >
              {files.length ? (
                <ul className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
                  {files.map((f, k) => (
                    <li key={`${f.name}-${k}`} className="flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-2.5 text-[12.5px]">
                      <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden />
                      <span className="max-w-[180px] truncate font-medium">{f.name}</span>
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
              <textarea
                ref={box}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.currentTarget;
                  eyes((o) => o.follow(el));
                }}
                onFocus={(e) => {
                  const el = e.currentTarget;
                  eyes((o) => o.follow(el));
                }}
                onBlur={() => eyes((o) => o.follow(null))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) void send(input);
                  }
                }}
                placeholder="Pergunte ou peça ao Orbi"
                className="block max-h-[180px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-snug outline-none placeholder:text-subtle"
                rows={1}
                maxLength={4000}
                aria-label="Mensagem"
              />
              <div className="flex items-center gap-1.5 px-1">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  aria-label="Anexar ficheiro"
                  title="Anexar imagem, PDF ou planilha"
                >
                  <Paperclip className="size-5" aria-hidden />
                </button>
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
                <span className="flex-1" />
                {canSend || !voiceOk.listen ? (
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
                    aria-label="Enviar"
                  >
                    <ArrowUp className="size-5" weight="bold" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openVoice}
                    className="flex size-9 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover"
                    aria-label="Iniciar chamada de voz com o Orbi"
                    title="Chamada de voz"
                  >
                    <Waveform className="size-5" weight="bold" aria-hidden />
                  </button>
                )}
              </div>
            </form>
            <p className="mx-auto mt-2 max-w-3xl px-2 text-center text-[11.5px] text-subtle">
              O Orbi pode enganar-se. As acções só acontecem quando confirmar.
            </p>
          </div>
        </section>
      </div>

      {/* Histórico (telemóvel) */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent title="Conversas" description="Todas as suas conversas com o Orbi.">
          <div className="-mx-2 flex max-h-[60dvh] flex-col">
            <button
              type="button"
              onClick={() => void open(null)}
              className="mx-3 mb-3 flex h-10 items-center gap-2.5 rounded-xl border border-border px-3 text-[13.5px] font-bold hover:bg-surface-2"
            >
              <NotePencil className="size-[18px]" aria-hidden />
              Nova conversa
            </button>
            {history}
          </div>
          <div className="mt-2 border-t border-border pt-2">
            <MemoryDialog companyId={companyId} trigger={memoryButton} />
          </div>
        </DialogContent>
      </Dialog>

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
