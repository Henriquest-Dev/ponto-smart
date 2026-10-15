"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusDot, type Tone } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

export type TodayRow = {
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

type FilterKey = "all" | "in" | "late" | "none";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "in", label: "Presentes" },
  { key: "late", label: "Atrasados" },
  { key: "none", label: "Sem marcação" },
];

const href = (id: string) => `/empresa/colaboradores/ficha/?id=${id}`;

function Wrap({ linkable, id, className, children }: { linkable: boolean; id: string; className: string; children: React.ReactNode }) {
  return linkable ? (
    <Link href={href(id)} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function TodayTable({ rows, linkable }: { rows: TodayRow[]; linkable: boolean }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !`${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(term)) return false;
      if (filter === "in") return !!r.firstIn;
      if (filter === "late") return r.status === "late";
      if (filter === "none") return !r.firstIn && !!r.schedule;
      return true;
    });
  }, [rows, q, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs items={FILTERS} active={filter} onChange={setFilter} />
        <div className="sm:w-64">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar nome ou departamento" aria-label="Pesquisar colaborador" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={rows.length ? "Nenhum colaborador corresponde ao filtro" : "Sem colaboradores activos"} />
      ) : (
        <>
          {/* Telemóvel: lista em cartões */}
          <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-background md:hidden">
            {filtered.map((r) => (
              <li key={r.id}>
                <Wrap linkable={linkable} id={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={r.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{r.name}</p>
                    <p className="truncate text-[12.5px] text-muted tabular">
                      {r.firstIn ? `${r.firstIn}${r.lastOut ? `–${r.lastOut}` : ", ainda dentro"}` : r.schedule ?? "Sem horário"}
                    </p>
                  </div>
                  <StatusDot tone={TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusDot>
                </Wrap>
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
                      <Wrap linkable={linkable} id={r.id} className="flex items-center gap-3">
                        <Avatar name={r.name} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-bold text-foreground">{r.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">{r.jobTitle ?? r.code}</span>
                        </span>
                      </Wrap>
                    </TD>
                    <TD className="text-muted">{r.department ?? "—"}</TD>
                    <TD className="tabular text-muted">{r.schedule ?? "—"}</TD>
                    <TD className="font-bold tabular">{r.firstIn ?? <span className="font-normal text-subtle">—</span>}</TD>
                    <TD className="font-bold tabular">{r.lastOut ?? <span className="font-normal text-subtle">—</span>}</TD>
                    <TD>
                      <StatusDot tone={TONE[r.status] ?? "neutral"}>
                        {r.statusLabel}
                        {r.lateMinutes ? <span className="text-[12px] font-bold text-warning tabular">+{r.lateMinutes} min</span> : null}
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
