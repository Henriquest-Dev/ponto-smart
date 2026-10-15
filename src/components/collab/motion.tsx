"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Carregamento: hastes arredondadas a pulsar em sequência (como o logótipo). */
export function StemLoader({
  className,
  count = 5,
}: {
  className?: string;
  count?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      role="status"
      aria-label="A carregar"
      className={cn(
        "inline-flex h-10 items-center gap-[5px] text-primary",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className="block w-[6px] rounded-full bg-current"
          initial={{ height: 12 }}
          animate={
            reduce
              ? { height: 20, opacity: 0.4 + (i % 2) * 0.4 }
              : { height: [12, 36, 12] }
          }
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration: 0.9,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.11,
                }
          }
        />
      ))}
    </span>
  );
}

/** Moldura de leitura sobre a câmara: cantos feitos de hastes e uma haste que varre o código. */
export function ScanFrame({ found = false }: { found?: boolean }) {
  const reduce = useReducedMotion();
  const corner = "absolute block rounded-full bg-white";
  const corners: [string, string][] = [
    ["left-0 top-0 h-[6px] w-12", "left-0 top-0 h-12 w-[6px]"],
    ["right-0 top-0 h-[6px] w-12", "right-0 top-0 h-12 w-[6px]"],
    ["left-0 bottom-0 h-[6px] w-12", "left-0 bottom-0 h-12 w-[6px]"],
    ["right-0 bottom-0 h-[6px] w-12", "right-0 bottom-0 h-12 w-[6px]"],
  ];
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-[13%] rounded-[28px] shadow-[0_0_0_999px_rgb(13_14_22/0.5)]"
      animate={reduce ? undefined : { scale: found ? 0.94 : [1, 0.975, 1] }}
      transition={
        found
          ? { duration: 0.2 }
          : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
      }
    >
      {corners.map(([h, v], i) => (
        <span key={i}>
          <span className={cn(corner, h, found && "bg-success")} />
          <span className={cn(corner, v, found && "bg-success")} />
        </span>
      ))}
      {reduce ? null : (
        <motion.span
          className="absolute inset-x-6 block h-[5px] rounded-full bg-primary shadow-[0_0_18px_4px_rgb(103_63_236/0.55)]"
          initial={{ top: "12%" }}
          animate={{ top: ["12%", "86%", "12%"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.div>
  );
}

/** Progresso por passos: hastes horizontais grossas que se preenchem. */
export function StemSteps({
  labels,
  current,
}: {
  labels: string[];
  current: number;
}) {
  const reduce = useReducedMotion();
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
            <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                initial={false}
                animate={{ width: done ? "100%" : active ? "55%" : "0%" }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 140, damping: 22 }
                }
              />
              {active && !reduce ? (
                <motion.div
                  className="absolute inset-y-0 w-6 rounded-full bg-white/50"
                  animate={{ left: ["-10%", "100%"] }}
                  transition={{
                    duration: 1.3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              ) : null}
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

/** Barra de progresso grossa e arredondada, animada ao aparecer. */
export function ThickBar({
  value,
  tone = "primary",
  className,
}: {
  value: number;
  tone?: "primary" | "success" | "warning";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const fill = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
  }[tone];
  return (
    <div
      className={cn(
        "h-2.5 overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className={cn("h-full rounded-full", fill)}
        initial={{ width: reduce ? `${pct}%` : "0%" }}
        animate={{ width: `${pct}%` }}
        transition={
          reduce ? { duration: 0 } : { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }
        }
      />
    </div>
  );
}
