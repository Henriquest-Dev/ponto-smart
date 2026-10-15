"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusDot, type Tone } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  code: string;
  jobTitle: string | null;
  department: string | null;
  schedule: string | null;
  firstIn: string | null;
  lastOut: string | null;
  status: string;
  statusLabel: string;
  lateMinutes: number;
};

const TONE: Record<string, Tone> = {
  on_time: "success", present: "success", late: "warning", incomplete: "warning", review: "primary",
  absent_pending: "danger", unjustified: "danger", justified: "info", none: "neutral", off: "neutral", holiday: "neutral", day_off: "neutral",
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "in", label: "Presentes" },
  { key: "late", label: "Atrasados" },
  { key: "none", label: "Sem marcação" },
];

export function TodayTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !`${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(term)) return false;
      if (filter === "in") return !!r.firstIn;
      if (filter === "late") return r.status === "late";
      if (filter === "none") return !r.firstIn && r.schedule;
      return true;
    });
  }, [rows, q, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface p-1 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-8 shrink-0 rounded-md px-3 text-[13px] font-medium",
                filter === f.key ? "bg-background text-primary shadow-[0_1px_2px_rgb(17_19_31/0.06)]" : "text-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar…" className="pl-9" aria-label="Pesquisar colaborador" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhum colaborador corresponde ao filtro" />
      ) : (
        <>
          {/* Telemóvel: lista em cartões */}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border md:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link href={`/empresa/colaboradores/${r.id}`} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={r.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted">
                      {r.firstIn ? `${r.firstIn}${r.lastOut ? ` → ${r.lastOut}` : ""}` : r.schedule ?? "Sem horário"}
                    </p>
                  </div>
                  <StatusDot tone={TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusDot>
                </Link>
              </li>
            ))}
          </ul>
          {/* Desktop: tabela */}
          <TableWrap className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <TH>Colaborador</TH>
                  <TH>Departamento</TH>
                  <TH>Horário</TH>
                  <TH>Entrada</TH>
                  <TH>Saída</TH>
                  <TH>Estado</TH>
                </tr>
              </THead>
              <tbody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/empresa/colaboradores/${r.id}`} className="flex items-center gap-3">
                        <Avatar name={r.name} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{r.name}</span>
                          <span className="block truncate text-xs text-muted">{r.jobTitle ?? r.code}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-muted">{r.department ?? "—"}</TD>
                    <TD className="tabular text-muted">{r.schedule ?? "—"}</TD>
                    <TD className="tabular">{r.firstIn ?? "—"}</TD>
                    <TD className="tabular">{r.lastOut ?? "—"}</TD>
                    <TD>
                      <StatusDot tone={TONE[r.status] ?? "neutral"}>
                        {r.statusLabel}
                        {r.lateMinutes ? <span className="text-xs text-muted">+{r.lateMinutes} min</span> : null}
                      </StatusDot>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </div>
  );
}
