"use client";

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import * as React from "react";
import { toast } from "sonner";
import { NoAccess } from "@/components/company/p2-shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "model"; text: string };
type Conversation = { id: string; title: string; messages: Msg[]; updated_at: string };

const NOT_ACTIVE = "O assistente ainda não está activo. Publique a função 'assistente' no Supabase.";

const SUGGESTIONS = [
  "Quem chegou atrasado mais vezes nos últimos 30 dias?",
  "Resume a assiduidade de hoje.",
  "Que justificações estão por decidir?",
  "Como está o processamento salarial deste mês?",
];

export default function AssistantPage() {
  const { can } = useCompany();
  if (!can("ai.use")) return <NoAccess title="Assistente" />;
  return <Assistant />;
}

/** Normaliza as mensagens guardadas (aceita também o formato antigo { role: "assistant", content }). */
function normalize(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const o = m as { role?: string; text?: string; content?: string };
      const text = o.text ?? o.content ?? "";
      return { role: o.role === "user" ? "user" : "model", text } as Msg;
    })
    .filter((m) => m.text);
}

async function ask(companyId: string, messages: Msg[]): Promise<string> {
  const { data, error } = await sb().functions.invoke("assistente", { body: { companyId, messages } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response | undefined;
      if (res?.status === 404) throw new Error(NOT_ACTIVE);
      let detail: string | null = null;
      try {
        const j = (await res?.json()) as { error?: string; message?: string } | undefined;
        detail = j?.error ?? j?.message ?? null;
      } catch {}
      if (res?.status === 401 || res?.status === 403) throw new Error(detail ?? "Sem acesso ao assistente.");
      throw new Error(detail ?? "O assistente não conseguiu responder. Tente novamente.");
    }
    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      throw new Error(`${NOT_ACTIVE} Se já está publicada, verifique a ligação à internet.`);
    }
    throw new Error(errorMessage(error));
  }
  const d = (data ?? {}) as { reply?: string; error?: string };
  if (d.error) throw new Error(d.error);
  if (!d.reply) throw new Error("O assistente não devolveu resposta.");
  return d.reply;
}

function Assistant() {
  const { companyId, me } = useCompany();
  const [cid, setCid] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [inactive, setInactive] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);

  const convs = useData(async () => {
    const { data, error } = await sb()
      .from("ai_conversations")
      .select("id,title,messages,updated_at")
      .eq("company_id", companyId)
      .eq("user_id", me.id)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) return [] as Conversation[]; // o histórico é opcional
    return (data ?? []).map((c) => ({ ...c, messages: normalize(c.messages) })) as Conversation[];
  }, [companyId, me.id]);

  React.useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, busy]);

  const open = (c: Conversation | null) => {
    if (busy) return;
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
      const { data } = await sb().from("ai_conversations").insert({ company_id: companyId, user_id: me.id, title, messages: all }).select("id").single();
      return (data as { id: string } | null)?.id ?? null;
    } catch {
      return id;
    }
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...messages, { role: "user" as const, text: t }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const reply = await ask(companyId, next);
      const all = [...next, { role: "model" as const, text: reply }];
      setMessages(all);
      setInactive(false);
      const id = await persist(cid, all);
      if (id !== cid) setCid(id);
      convs.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      if (msg.startsWith(NOT_ACTIVE)) setInactive(true);
      else toast.error(msg);
      setMessages(messages);
      setInput(t);
    } finally {
      setBusy(false);
    }
  }

  const remove = async (c: Conversation) => {
    if (!window.confirm(`Apagar a conversa "${c.title}"?`)) return;
    const { error } = await sb().from("ai_conversations").delete().eq("id", c.id);
    if (error) return void toast.error(errorMessage(error));
    if (c.id === cid) open(null);
    convs.reload();
  };

  const list = convs.data ?? [];

  return (
    <>
      <PageHeader title="Assistente" description="Perguntas sobre assiduidade, justificações e salários, com dados limitados ao seu papel." />
      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-10 lg:py-7">
        {inactive ? <Notice tone="warning" title="Assistente desactivado">{NOT_ACTIVE}</Notice> : null}
        <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
          <aside className="min-w-0">
            <div className="flex items-center justify-between gap-3 lg:block">
              <h2 className="text-[15px] font-extrabold tracking-[-0.01em] lg:mb-3">Conversas</h2>
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
                        "flex max-w-56 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:max-w-none",
                        c.id === cid && "bg-surface-2 font-bold text-foreground",
                      )}
                    >
                      <span className={cn("stem h-3.5 transition-colors", c.id === cid ? "text-primary" : "text-transparent")} aria-hidden />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="hidden shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-bold text-subtle hover:bg-danger-soft hover:text-danger group-hover:block focus-visible:block"
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

          <section className="flex min-h-[calc(100dvh-16rem)] min-w-0 flex-col rounded-[22px] border border-border bg-background">
            <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" aria-live="polite">
              {messages.length === 0 ? (
                <div className="max-w-xl py-6 sm:py-10">
                  <p className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">Em que posso ajudar?</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                    Consulto dados da empresa dentro das permissões do seu papel. Não aprovo, não pago e não aplico sanções.
                  </p>
                  <p className="mt-7 text-[13px] font-bold">Perguntas frequentes</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="cursor-pointer rounded-full bg-surface-2 px-4 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-primary-soft hover:text-primary"
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
                        "max-w-[85%] rounded-[22px] px-4 py-3 text-[14px] leading-relaxed break-words sm:max-w-[75%]",
                        m.role === "user" ? "rounded-br-[8px] bg-foreground whitespace-pre-wrap text-background" : "rounded-bl-[8px] bg-surface-2 text-foreground",
                      )}
                    >
                      {m.role === "model" ? <RichText text={m.text} /> : m.text}
                    </div>
                  </div>
                ))
              )}
              {busy ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2.5 rounded-[22px] rounded-bl-[8px] bg-surface-2 px-4 py-3 text-[13.5px] font-medium text-muted">
                    <span className="spinner" aria-hidden /> A consultar dados
                  </div>
                </div>
              ) : null}
              <div ref={end} />
            </div>
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
                placeholder="Escreva uma pergunta"
                className="min-h-11 resize-none"
                rows={1}
                maxLength={4000}
                aria-label="Mensagem"
              />
              <Button type="submit" disabled={busy || !input.trim()} className="shrink-0">
                Enviar
              </Button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}

/** Formatação mínima e segura das respostas (negrito, código e listas), sem HTML arbitrário. */
function RichText({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-extrabold">{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i} className="rounded-[6px] bg-background px-1.5 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>
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
          <span key={i} className={cn("block", (bullet || numbered) && "pl-4", /^\s{2,}/.test(raw) && "pl-8", heading && "mt-1 font-extrabold")}>
            {bullet ? <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-primary align-middle" aria-hidden /> : null}
            {inline(bullet ? line.replace(/^\s*[-*]\s+/, "") : heading ? line.replace(/^#{1,4}\s+/, "") : line.trim())}
          </span>
        );
      })}
    </>
  );
}
