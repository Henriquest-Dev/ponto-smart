"use client";

import * as React from "react";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { must } from "@/lib/sb/client";

/** Data de hoje (YYYY-MM-DD) no fuso indicado. */
export function todayIn(timeZone = "Africa/Maputo") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Primeiro e último dia de um mês (YYYY-MM). */
export function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { year: y, month: m, from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

type RangeQuery<T> = { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> };

/**
 * Lê todas as linhas de uma consulta em páginas (o PostgREST limita cada resposta, tipicamente a 1000).
 * `build` tem de devolver uma consulta nova a cada chamada, já ordenada de forma estável.
 */
export async function fetchAll<T>(build: () => RangeQuery<T>, pageSize = 1000, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const rows = must(await build().range(from, from + pageSize - 1)) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Ligação para o relatório mensal de um colaborador (mês opcional, YYYY-MM). */
export function employeeReportHref(id: string, ym?: string) {
  return `/empresa/relatorios/colaborador/?id=${id}${ym ? `&mes=${ym}` : ""}`;
}

/** Divide uma lista em blocos (para filtros `in` com muitos ids). */
export function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Página sem permissão. */
export function NoAccess({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <EmptyState title="Sem acesso" description="O seu papel não tem permissão para esta área. Fale com o administrador da empresa." />
      </PageBody>
    </>
  );
}

/** Bloco de carregamento genérico. */
export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={i === 0 ? "h-24 w-full rounded-xl" : "h-14 w-full rounded-lg"} />
      ))}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return <Notice tone="danger">{message}</Notice>;
}
