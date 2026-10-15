"use client";

import { ArrowUp, Download, FileText, Loader2, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; artifacts?: Artifact[] };
type Artifact = { executionId: string; kind: "notification_draft" | "document" };

const SUGGESTIONS = [
  "Quem chegou atrasado mais vezes nos últimos 30 dias?",
  "Resume a assiduidade do mês passado.",
  "Que justificações estão por decidir?",
  "Explica o cálculo do recibo do colaborador MHL-0103 do mês passado.",
];

export function AssistantChat({ conversations, conversationId, initial }: { conversations: { id: string; title: string }[]; conversationId: string | null; initial: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cid, setCid] = useState(conversationId);
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: cid, message: text }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Erro");
      setMessages((m) => [...m, { role: "assistant", content: json.reply, artifacts: json.artifacts }]);
      if (!cid) {
        setCid(json.conversationId);
        router.replace(`/empresa/assistente?c=${json.conversationId}`, { scroll: false });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
      setMessages((m) => m.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:block">
        <Button variant="outline" className="w-full" asChild>
          <Link href="/empresa/assistente"><Plus /> Nova conversa</Link>
        </Button>
        <ul className="mt-4 space-y-0.5">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/empresa/assistente?c=${c.id}`} className={cn("block truncate rounded-md px-3 py-2 text-[13px] text-muted hover:bg-surface hover:text-foreground", c.id === cid && "bg-surface font-medium text-foreground")}>
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-[calc(100dvh-16rem)] flex-col rounded-xl border border-border">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-lg py-8 text-center">
              <p className="text-[15px] font-semibold">Como posso ajudar?</p>
              <p className="mt-1 text-[13px] text-muted">O assistente consulta dados da empresa através de ferramentas autorizadas. Não aprova, não paga e não aplica sanções.</p>
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-lg border border-border px-3 py-2.5 text-[13px] hover:border-primary/30 hover:bg-primary-soft/30">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap", m.role === "user" ? "bg-primary text-white" : "bg-surface")}>
                  {m.content}
                  {m.artifacts?.map((a) => <ArtifactCard key={a.executionId} artifact={a} />)}
                </div>
              </div>
            ))
          )}
          {busy ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" /> A consultar dados…
            </div>
          ) : null}
          <div ref={end} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-border p-3"
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
            placeholder="Escreva uma pergunta…"
            className="min-h-11 resize-none"
            rows={1}
            maxLength={4000}
            aria-label="Mensagem"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Enviar">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </form>
      </section>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [state, setState] = useState<"pending" | "sent" | "rejected">("pending");
  const [busy, setBusy] = useState(false);
  if (artifact.kind === "document") {
    return (
      <a href={`/api/ai/executions/${artifact.executionId}?download=1`} className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground">
        <FileText className="size-4 text-primary" /> Documento gerado <Download className="ml-auto size-4 text-muted" />
      </a>
    );
  }
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    const res = await fetch(`/api/ai/executions/${artifact.executionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) return void toast.error(json.error?.message ?? "Erro");
    setState(decision === "approve" ? "sent" : "rejected");
    if (decision === "approve") toast.success(`Notificação enviada a ${json.sent} colaboradores.`);
  };
  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3 text-foreground">
      <p className="text-xs font-medium">Rascunho de notificação</p>
      {state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide("approve")}><Send /> Confirmar envio</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("reject")}>Descartar</Button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">{state === "sent" ? "Enviada." : "Descartada."}</p>
      )}
    </div>
  );
}
