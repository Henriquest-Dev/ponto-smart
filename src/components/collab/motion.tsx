"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Carregamento: spinner simples. */
export function StemLoader({
  className,
}: {
  className?: string;
  count?: number;
}) {
  return (
    <span
      role="status"
      aria-label="A carregar"
      className={cn("inline-flex h-10 items-center", className)}
    >
      <span className="spinner" />
    </span>
  );
}

/** Moldura de leitura sobre a câmara: cantos feitos de hastes (estática). */
export function ScanFrame({ found = false }: { found?: boolean }) {
  const corner = "absolute block rounded-full bg-white";
  const corners: [string, string][] = [
    ["left-0 top-0 h-[6px] w-12", "left-0 top-0 h-12 w-[6px]"],
    ["right-0 top-0 h-[6px] w-12", "right-0 top-0 h-12 w-[6px]"],
    ["left-0 bottom-0 h-[6px] w-12", "left-0 bottom-0 h-12 w-[6px]"],
    ["right-0 bottom-0 h-[6px] w-12", "right-0 bottom-0 h-12 w-[6px]"],
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-[13%] rounded-xl shadow-[0_0_0_999px_rgb(13_14_22/0.5)]"
    >
      {corners.map(([h, v], i) => (
        <span key={i}>
          <span className={cn(corner, h, found && "bg-success")} />
          <span className={cn(corner, v, found && "bg-success")} />
        </span>
      ))}
    </div>
  );
}

/** Progresso por passos: hastes horizontais que se preenchem. */
export function StemSteps({
  labels,
  current,
}: {
  labels: string[];
  current: number;
}) {
  return (
    <ol
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`,
      }}
      aria-label="Progresso"
    >
      {labels.map((l, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={l} aria-current={active ? "step" : undefined}>
            <div className="relative h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300"
                style={{ width: done ? "100%" : active ? "55%" : "0%" }}
              />
            </div>
            <p
              className={cn(
                "mt-2 text-[12.5px] font-bold transition-colors",
                done || active ? "text-foreground" : "text-subtle",
              )}
            >
              {l}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Cronómetro ao segundo desde `since` (descontando `baseMinutes` negativos, ex.: intervalos). */
export function LiveTimer({
  since,
  baseMinutes = 0,
  className,
}: {
  since: string;
  baseMinutes?: number;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs =
    now === null
      ? 0
      : Math.max(
          0,
          Math.floor((now - new Date(since).getTime()) / 1000) +
            baseMinutes * 60,
        );
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (
    <span
      className={cn("tabular", className)}
      suppressHydrationWarning
      aria-label={`${h} horas e ${m} minutos`}
    >
      {h}
      <span className="text-[0.55em] opacity-50">h</span>
      {String(m).padStart(2, "0")}
      <span className="ml-1 align-baseline text-[0.42em] opacity-45">
        {String(s).padStart(2, "0")}
      </span>
    </span>
  );
}

/** Barra de progresso fina e arredondada. */
export function ThickBar({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "success" | "warning";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const fill = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
  }[tone];
  return (
    <div
      className={cn(
        "h-1.5 overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
