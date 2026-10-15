"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

/** Número que conta até ao valor final uma única vez (sem animação se o utilizador a reduzir). */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("pt-PT"));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

type Segment = { key: string; label: string; value: number; className: string; textClass: string };

export type PendingLink = { n: number; label: string; href: string };

/** Resumo de hoje: número grande, barra dividida (pontuais, atrasados, em falta) e pendências. */
export function TodayOverview({
  scheduled,
  present,
  late,
  dateLabel,
  punctuality,
  pending,
}: {
  scheduled: number;
  present: number;
  late: number;
  dateLabel: string;
  punctuality: number;
  pending: PendingLink[];
}) {
  const reduce = useReducedMotion();
  const base = Math.max(scheduled, present);
  const onTime = Math.max(0, present - late);
  const missing = Math.max(0, base - present);
  const segments: Segment[] = [
    { key: "on", label: "Pontuais", value: onTime, className: "bg-primary", textClass: "text-primary" },
    { key: "late", label: "Atrasados", value: late, className: "bg-warning", textClass: "text-warning" },
    { key: "miss", label: "Sem marcação", value: missing, className: "bg-danger/70", textClass: "text-danger" },
  ];
  const pct = base ? Math.round((present / base) * 100) : 0;

  return (
    <section aria-labelledby="hoje-titulo" className="rounded-xl border border-border bg-background">
      <div className="grid gap-8 px-5 py-6 sm:px-7 sm:py-7 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <h2 id="hoje-titulo" className="text-[15px] font-bold text-muted">
            Hoje, {dateLabel}
          </h2>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[56px] leading-none font-bold tracking-[-0.02em] tabular sm:text-[72px]">
              <CountUp value={present} />
            </span>
            <span className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-muted sm:text-[26px]">
              de <span className="tabular">{base}</span> presentes
            </span>
          </p>
          <p className="mt-2 text-[13.5px] text-muted">
            {base === 0
              ? "Ninguém tem horário para hoje."
              : missing === 0
                ? "Todos os colaboradores com horário já marcaram entrada."
                : `${missing} ${missing === 1 ? "colaborador ainda não marcou" : "colaboradores ainda não marcaram"} entrada.`}
          </p>
        </div>
        <dl className="flex gap-8 lg:justify-end">
          <div>
            <dt className="text-[13px] font-bold text-muted">Presença</dt>
            <dd className="mt-1 text-[28px] leading-none font-bold tracking-[-0.02em] tabular">{pct}%</dd>
          </div>
          <div>
            <dt className="text-[13px] font-bold text-muted">Pontualidade, 30 dias</dt>
            <dd className="mt-1 text-[28px] leading-none font-bold tracking-[-0.02em] tabular">{punctuality.toLocaleString("pt-PT")}%</dd>
          </div>
        </dl>
      </div>

      <div className="px-5 sm:px-7">
        <div
          className="flex h-4 w-full gap-1 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}
        >
          {base > 0
            ? segments
                .filter((s) => s.value > 0)
                .map((s, i) => (
                  <motion.span
                    key={s.key}
                    className={cn("h-full rounded-full", s.className)}
                    style={{ flexGrow: s.value, flexBasis: 0, transformOrigin: "left" }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                  />
                ))
            : null}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
          {segments.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-2 text-[13.5px]">
              <span className={cn("stem", s.textClass)} aria-hidden />
              <span className="font-bold tabular">{s.value}</span>
              <span className="text-muted">{s.label.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </div>

      {pending.length ? (
        <div className="mt-6 border-t border-border px-5 py-4 sm:px-7">
          <p className="text-[13px] font-bold text-muted">Por tratar</p>
          <ul className="mt-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-8">
            {pending.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="group inline-flex items-center gap-2 py-1 text-[14px]">
                  <span className="stem text-warning" aria-hidden />
                  <span className="font-bold tabular">{p.n}</span>
                  <span className="font-bold underline decoration-2 decoration-transparent underline-offset-4 transition-colors group-hover:text-primary group-hover:decoration-primary/40">
                    {p.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="h-6" />
      )}
    </section>
  );
}
