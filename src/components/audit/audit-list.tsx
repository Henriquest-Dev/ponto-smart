"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { AUDIT_CATEGORIES, actorLabel, describeAudit, isNoise, type AuditCategory, type AuditContext, type AuditRowInput, type AuditText } from "@/lib/audit-text";
import { formatDateTime } from "@/lib/format";

export type AuditCategoryFilter = AuditCategory | "all";

export type AuditListRow = AuditRowInput & {
  id: string;
  actor_id: string | null;
  created_at: string;
  actorName?: string | null;
  /** Texto extra por baixo da frase (ex.: empresa, na plataforma). */
  meta?: string;
};

type Described = AuditListRow & AuditText & { actor: string };

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Separadores de categoria e caixa de pesquisa. */
export function AuditFilters({
  category,
  onCategory,
  search,
  onSearch,
  categories = AUDIT_CATEGORIES,
  children,
}: {
  category: AuditCategoryFilter;
  onCategory: (c: AuditCategoryFilter) => void;
  search: string;
  onSearch: (s: string) => void;
  categories?: AuditCategory[];
  children?: React.ReactNode;
}) {
  const items: { key: AuditCategoryFilter; label: string }[] = [{ key: "all", label: "Todas" }, ...categories.map((c) => ({ key: c, label: c }))];
  return (
    <div className="space-y-3">
      <Tabs items={items} active={category} onChange={onCategory} className="w-full" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Procurar por pessoa ou acção nesta página"
          aria-label="Procurar"
          className="sm:max-w-sm"
        />
        {children}
      </div>
    </div>
  );
}

/** Lista legível do trilho de auditoria: quem, o quê e quando, com as alterações por extenso. */
export function AuditList({ rows, context, search, tz }: { rows: AuditListRow[]; context: AuditContext; search: string; tz?: string }) {
  const described = React.useMemo<Described[]>(
    () =>
      rows
        .filter((r) => !isNoise(r))
        .map((r) => ({ ...r, ...describeAudit(r, context), actor: actorLabel(r.actorName, r.actor_id) })),
    [rows, context],
  );
  const q = norm(search.trim());
  const shown = q ? described.filter((r) => norm(`${r.actor} ${r.sentence} ${r.category} ${r.meta ?? ""}`).includes(q)) : described;

  if (!shown.length) {
    return (
      <p className="rounded-xl border border-border bg-background px-4 py-6 text-center text-[13.5px] text-muted">
        {q ? "Nenhum registo desta página corresponde à pesquisa." : "Nesta página só há registos técnicos, sem acções de utilizadores."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
      {shown.map((r) => (
        <li key={r.id} className="px-4 py-3">
          <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:justify-between md:gap-6">
            <p className="min-w-0 text-[14px] leading-snug break-words">
              <span className="font-bold">{r.actor}</span> {r.sentence}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Badge>{r.category}</Badge>
              <span className="text-[12.5px] whitespace-nowrap text-muted tabular">{formatDateTime(r.created_at, tz)}</span>
            </div>
          </div>
          {r.meta ? <p className="mt-0.5 text-[12.5px] text-muted">{r.meta}</p> : null}
          {r.changes.length ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[12.5px] font-bold text-muted hover:text-foreground">Ver alterações</summary>
              <ul className="mt-1.5 space-y-1 border-l border-border pl-3 text-[13px]">
                {r.changes.map((c, i) => (
                  <li key={i} className="break-words">
                    <span className="text-muted">{c.label}:</span>{" "}
                    {c.before === "—" && c.after !== "—" ? c.after : `${c.before} → ${c.after}`}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
