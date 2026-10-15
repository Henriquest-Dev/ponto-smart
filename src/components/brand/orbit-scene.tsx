"use client";

import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cena 2.5D da Horbit: um local de trabalho visto em perspectiva, com o
 * perímetro (órbitas) no chão, o pino do local ao centro, o ecrã da estação ao
 * fundo e o telemóvel à frente. Em ciclo: o QR é lido, o ponto do colaborador
 * aproxima-se do centro e a entrada fica registada.
 * Reage ao cursor (inclinação suave) e respeita prefers-reduced-motion.
 */

const STAGE = 560; // sistema de coordenadas interno (px)
const CYCLE = 6400; // ms
type Phase = 0 | 1 | 2; // 0 ler QR · 1 confirmar local · 2 registado

const VIOLET = "#673fec";
const INK = "#1a1530";

function usePhase(still: boolean): Phase {
  const [phase, setPhase] = React.useState<Phase>(still ? 2 : 0);
  React.useEffect(() => {
    if (still) return;
    let t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - t0) % CYCLE;
      if (now - t0 > CYCLE * 1000) t0 = now;
      setPhase(t < 1700 ? 0 : t < 3500 ? 1 : 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still]);
  return phase;
}

function useFitScale(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(e.contentRect.width, e.contentRect.height) / STAGE));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

export function OrbitScene({ className, compact = false }: { className?: string; compact?: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const phase = usePhase(reduce);
  const box = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(box);

  // Inclinação com o cursor (parallax).
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [8, -8]), { stiffness: 80, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-10, 10]), { stiffness: 80, damping: 18 });

  React.useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      mx.set((e.clientX / window.innerWidth) * 2 - 1);
      my.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [mx, my, reduce]);

  return (
    <div ref={box} className={cn("relative aspect-square w-full select-none", className)} aria-hidden>
      <div className="absolute top-1/2 left-1/2" style={{ width: STAGE, height: STAGE, marginLeft: -STAGE / 2, marginTop: -STAGE / 2, scale }}>
        <div className="absolute inset-0" style={{ perspective: 1500 }}>
          <motion.div className="absolute inset-0" style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}>
            <Ground phase={phase} still={reduce} />
            {!compact ? <StationPanel phase={phase} still={reduce} /> : null}
            <PhonePanel phase={phase} compact={compact} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chão: órbitas do perímetro, pino do local e o ponto do colaborador   */
/* ------------------------------------------------------------------ */

function Ground({ phase, still }: { phase: Phase; still: boolean }) {
  const radius = useMotionValue(still ? 0 : 196);
  const angle = useMotionValue(0);

  React.useEffect(() => {
    if (still) return;
    const spin = animate(angle, 360, { duration: 7, repeat: Infinity, ease: "linear" });
    return () => spin.stop();
  }, [angle, still]);

  React.useEffect(() => {
    if (still) return;
    if (phase === 0) radius.set(196);
    if (phase === 1) animate(radius, 0, { duration: 1.6, ease: [0.45, 0, 0.2, 1] });
  }, [phase, radius, still]);

  const x = useTransform(() => Math.cos((angle.get() * Math.PI) / 180) * radius.get());
  const y = useTransform(() => Math.sin((angle.get() * Math.PI) / 180) * radius.get());

  return (
    <div
      className="absolute top-1/2 left-1/2"
      style={{ width: 460, height: 460, marginLeft: -230, marginTop: -170, transform: "rotateX(62deg) rotateZ(-38deg)", transformStyle: "preserve-3d" }}
    >
      {/* Placa do local */}
      <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, rgba(103,63,236,0.28) 0%, rgba(103,63,236,0.08) 45%, transparent 70%)" }} />
      <svg viewBox="0 0 460 460" className="absolute inset-0 overflow-visible">
        <circle cx="230" cy="230" r="216" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2" />
        <motion.circle
          cx="230"
          cy="230"
          r="196"
          fill="none"
          stroke="rgba(255,255,255,0.32)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="2 22"
          style={{ originX: "230px", originY: "230px" }}
          animate={still ? undefined : { rotate: -360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />
        <circle cx="230" cy="230" r="128" fill="rgba(103,63,236,0.16)" stroke={VIOLET} strokeWidth="5" />
        <circle cx="230" cy="230" r="64" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      </svg>

      {/* Onda ao registar */}
      <motion.div
        className="absolute top-1/2 left-1/2 rounded-full border-[6px]"
        style={{ width: 256, height: 256, marginLeft: -128, marginTop: -128, borderColor: VIOLET }}
        animate={phase === 2 && !still ? { scale: [0.3, 1.25], opacity: [0.9, 0] } : { opacity: 0 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />

      {/* Colaborador (ponto GPS) */}
      <motion.div className="absolute top-1/2 left-1/2" style={{ x, y, transformStyle: "preserve-3d" }}>
        <div className="-mt-5 -ml-5 size-10 rounded-full" style={{ background: "rgba(34,197,94,0.25)" }} />
        <div className="absolute top-0 left-0 -mt-[11px] -ml-[11px] size-[22px] rounded-full border-[4px] border-white" style={{ background: "#22c55e" }} />
      </motion.div>

      {/* Pino do local: haste e cabeça, como o "i" do logótipo, de pé */}
      <div className="absolute top-1/2 left-1/2" style={{ transform: "rotateZ(38deg) rotateX(-62deg)", transformOrigin: "0 0", transformStyle: "preserve-3d" }}>
        <motion.div
          className="absolute"
          style={{ left: -14, bottom: 0 }}
          animate={still ? undefined : { y: [0, -6, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="mx-auto mb-2 size-7 rounded-full" style={{ background: VIOLET }} />
          <div className="mx-auto h-24 w-7 rounded-full" style={{ background: `linear-gradient(${VIOLET}, #4b23c9)` }} />
        </motion.div>
        <motion.div
          className="absolute rounded-[16px] bg-white px-4 py-3 whitespace-nowrap"
          style={{ left: 26, bottom: 150, boxShadow: "0 24px 40px -18px rgba(0,0,0,0.55)" }}
          initial={false}
          animate={phase === 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 14, scale: 0.92 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <p className="text-[15px] font-extrabold" style={{ color: INK }}>
            Entrada registada
          </p>
          <p className="text-[12px] font-medium text-[#5f5a75]">07:58, dentro do perímetro</p>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ecrã da estação (ao fundo)                                          */
/* ------------------------------------------------------------------ */

function useQrCells(phase: Phase) {
  const [seed, setSeed] = React.useState(7);
  React.useEffect(() => {
    if (phase === 0) setSeed((s) => s + 1);
  }, [phase]);
  return React.useMemo(() => {
    const cells: [number, number][] = [];
    let v = seed * 9301 + 49297;
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 13; x++) {
        v = (v * 9301 + 49297) % 233280;
        const finder = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8);
        if (!finder && v / 233280 > 0.52) cells.push([x, y]);
      }
    return cells;
  }, [seed]);
}

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width="4" height="4" rx="1.2" fill={INK} />
      <rect x={x + 0.8} y={y + 0.8} width="2.4" height="2.4" rx="0.7" fill="#fff" />
      <rect x={x + 1.4} y={y + 1.4} width="1.2" height="1.2" rx="0.4" fill={INK} />
    </g>
  );
}

function StationPanel({ phase, still }: { phase: Phase; still: boolean }) {
  const cells = useQrCells(phase);
  return (
    <motion.div
      className="absolute rounded-[26px] bg-white p-5"
      style={{ left: 22, top: 40, width: 190, transform: "translateZ(-90px) rotateY(18deg)", boxShadow: "0 40px 60px -30px rgba(0,0,0,0.6)" }}
      animate={still ? undefined : { y: [0, -8, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
    >
      <p className="text-[11px] font-bold text-[#5f5a75]">Estação da recepção</p>
      <div className="mt-3 rounded-[14px] bg-[#f3f1fa] p-3">
        <motion.svg
          key={cells.length + cells[0]?.join()}
          viewBox="0 0 13 13"
          className="block w-full"
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
        >
          {cells.map(([x, y]) => (
            <rect key={`${x}.${y}`} x={x + 0.08} y={y + 0.08} width="0.84" height="0.84" rx="0.3" fill={INK} />
          ))}
          <Finder x={0} y={0} />
          <Finder x={9} y={0} />
          <Finder x={0} y={9} />
        </motion.svg>
      </div>
      <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-[#efeafe]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: VIOLET }}
          animate={still ? { width: "60%" } : { width: ["100%", "0%"] }}
          transition={{ duration: CYCLE / 1000, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <p className="mt-2 text-[10.5px] font-medium text-[#8c88a0]">Código novo a cada 30 s</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Telemóvel do colaborador (à frente)                                 */
/* ------------------------------------------------------------------ */

const STEPS = ["Ler o código", "Confirmar o local", "Entrada registada"] as const;

function PhonePanel({ phase, compact }: { phase: Phase; compact: boolean }) {
  return (
    <motion.div
      className="absolute rounded-[34px] border-[7px] p-0"
      style={{
        right: compact ? 40 : 18,
        top: compact ? 270 : 262,
        width: 196,
        borderColor: "#0f0b1f",
        background: "#0f0b1f",
        transform: "translateZ(120px) rotateY(-16deg) rotateX(4deg)",
        boxShadow: "0 50px 80px -30px rgba(0,0,0,0.7)",
      }}
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <div className="overflow-hidden rounded-[27px] bg-[#f7f6fb] px-4 pt-3 pb-4">
        <div className="mx-auto mb-3 h-[5px] w-12 rounded-full bg-[#0f0b1f]" />
        <p className="text-[10.5px] font-bold text-[#8c88a0]">Loja da Baixa</p>
        <p className="text-[16px] leading-tight font-extrabold" style={{ color: INK }}>
          Marcar ponto
        </p>
        <ol className="mt-3 space-y-2">
          {STEPS.map((s, i) => {
            const done = phase > i || (phase === 2 && i === 2);
            const current = phase === i && !done;
            return (
              <li key={s} className="flex items-center gap-2.5">
                <motion.span
                  className="h-4 w-[5px] rounded-full"
                  animate={{ backgroundColor: done ? "#16834f" : current ? VIOLET : "#d6d2e4", scaleY: current ? [1, 1.35, 1] : 1 }}
                  transition={{ duration: 0.8, repeat: current ? Infinity : 0 }}
                />
                <span className={cn("text-[12px] font-bold", done ? "text-[#16834f]" : current ? "text-[#1a1530]" : "text-[#8c88a0]")}>{s}</span>
              </li>
            );
          })}
        </ol>
        <motion.div
          className="mt-4 flex h-10 items-center justify-center rounded-full text-[12.5px] font-extrabold text-white"
          animate={{ backgroundColor: phase === 2 ? "#16834f" : VIOLET }}
          transition={{ duration: 0.3 }}
        >
          {phase === 2 ? "Registado às 07:58" : phase === 1 ? "A confirmar…" : "A ler o QR…"}
        </motion.div>
      </div>
    </motion.div>
  );
}
