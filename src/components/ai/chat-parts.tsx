"use client";

import { Brain, ChatCircleDots, MagnifyingGlass, PencilSimple, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { errorMessage, rpc } from "@/lib/sb/client";
import { cn } from "@/lib/utils";

/** Avatar pequeno do Orbi (estático, para cada resposta). */
export function OrbiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <defs>
        <radialGradient id="orbi-ball" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f1ecff" />
          <stop offset="100%" stopColor="#c9b8ff" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#orbi-ball)" stroke="#e4dcff" />
      <circle cx="17.5" cy="15.5" r="8" fill="#663fec" stroke="#2c1678" strokeOpacity=".5" />
      <circle cx="18.3" cy="15" r="4.2" fill="#100830" />
      <circle cx="16.4" cy="13.1" r="1.4" fill="#fff" />
    </svg>
  );
}

export type ConversationItem = { id: string; title: string; updated_at: string };

/** Agrupa por data, como num histórico de chat. */
function groupByDate(list: ConversationItem[]) {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const groups: { label: string; items: ConversationItem[] }[] = [
    { label: "Hoje", items: [] },
    { label: "Ontem", items: [] },
    { label: "Últimos 7 dias", items: [] },
    { label: "Últimos 30 dias", items: [] },
    { label: "Mais antigas", items: [] },
  ];
  for (const c of list) {
    const t = new Date(c.updated_at).getTime();
    const i = t >= t0 ? 0 : t >= t0 - day ? 1 : t >= t0 - 7 * day ? 2 : t >= t0 - 30 * day ? 3 : 4;
    groups[i].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

/** Histórico de todas as conversas: pesquisa, grupos por data, mudar o nome e apagar. */
export function ChatHistory({
  list,
  loading,
  activeId,
  onOpen,
  onRename,
  onDelete,
}: {
  list: ConversationItem[];
  loading?: boolean;
  activeId: string | null;
  onOpen: (c: ConversationItem) => void;
  onRename: (c: ConversationItem, title: string) => void;
  onDelete: (c: ConversationItem) => void;
}) {
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const filtered = q.trim() ? list.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase())) : list;
  const groups = groupByDate(filtered);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="relative mx-3 mb-2 block">
        <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Procurar conversas"
          aria-label="Procurar conversas"
          className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-[13px] outline-none placeholder:text-subtle focus:border-primary"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && !list.length ? <p className="px-3 py-2 text-[13px] text-muted">A carregar…</p> : null}
        {!loading && !list.length ? (
          <p className="px-3 py-2 text-[13px] leading-relaxed text-muted">As suas conversas com o Orbi ficam guardadas aqui.</p>
        ) : null}
        {list.length && !filtered.length ? <p className="px-3 py-2 text-[13px] text-muted">Nenhuma conversa com esse nome.</p> : null}
        {groups.map((g) => (
          <div key={g.label} className="mt-2 first:mt-0">
            <p className="px-3 pt-2 pb-1 text-[11.5px] font-bold text-subtle">{g.label}</p>
            <ul>
              {g.items.map((c) => (
                <li key={c.id} className="group relative">
                  {editing === c.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = String(new FormData(e.currentTarget).get("t") ?? "").trim();
                        if (v && v !== c.title) onRename(c, v.slice(0, 80));
                        setEditing(null);
                      }}
                    >
                      <input
                        name="t"
                        defaultValue={c.title}
                        autoFocus
                        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                        onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                        className="h-9 w-full rounded-lg border border-primary bg-background px-3 text-[13px] outline-none"
                        aria-label="Nome da conversa"
                      />
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpen(c)}
                        className={cn(
                          "flex h-9 w-full items-center gap-2.5 rounded-lg pr-16 pl-3 text-left text-[13.5px] transition-colors hover:bg-surface-2",
                          c.id === activeId ? "bg-surface-2 font-bold text-foreground" : "text-foreground/80",
                        )}
                      >
                        <ChatCircleDots className="size-4 shrink-0 text-subtle" aria-hidden />
                        <span className="truncate">{c.title}</span>
                      </button>
                      <span className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 gap-0.5 group-focus-within:flex group-hover:flex">
                        <button
                          type="button"
                          onClick={() => setEditing(c.id)}
                          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-background hover:text-foreground"
                          aria-label={`Mudar o nome de ${c.title}`}
                        >
                          <PencilSimple className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(c)}
                          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                          aria-label={`Apagar ${c.title}`}
                        >
                          <Trash className="size-3.5" aria-hidden />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type Memory = { id: string; content: string; at: string };

/** O que o Orbi lembra desta pessoa: ver, apagar um facto ou apagar tudo. */
export function MemoryDialog({ companyId, trigger }: { companyId: string | null; trigger: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Memory[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setItems(await rpc<Memory[]>("ps_ai_memories", { p_company: companyId }));
    } catch (e) {
      const m = errorMessage(e);
      setError(/ps_ai_memories|função em falta/i.test(m) ? "Corra o script supabase/04_parte10.sql no Supabase para activar a memória." : m);
      setItems([]);
    }
  }, [companyId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const remove = async (m: Memory) => {
    try {
      await rpc("ps_ai_memory_delete", { p_id: m.id });
      setItems((cur) => (cur ?? []).filter((x) => x.id !== m.id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const clear = async () => {
    if (!window.confirm("Apagar tudo o que o Orbi lembra? As conversas mantêm-se.")) return;
    try {
      await rpc("ps_ai_memory_clear", { p_company: companyId });
      setItems([]);
      toast.success("Memória apagada.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Memória do Orbi"
        description="O que o Orbi aprendeu nas suas conversas (preferências, decisões, pedidos para lembrar). É só sua e serve para as próximas conversas."
      >
        {error ? <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">{error}</p> : null}
        {items === null ? (
          <p className="text-[13.5px] text-muted">A carregar…</p>
        ) : items.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {items.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                <Brain className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p className="min-w-0 flex-1 text-[13.5px] leading-snug">{m.content}</p>
                <button type="button" onClick={() => void remove(m)} className="shrink-0 text-[12.5px] font-bold text-muted hover:text-danger">
                  Esquecer
                </button>
              </li>
            ))}
          </ul>
        ) : !error ? (
          <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-muted">
            Ainda não há nada na memória. Diga, por exemplo, &quot;Lembra-te que prefiro respostas curtas&quot; e o Orbi passa a lembrar.
          </p>
        ) : null}
        {items?.length ? (
          <Button variant="ghost" className="mt-4" onClick={() => void clear()}>
            Apagar toda a memória
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
