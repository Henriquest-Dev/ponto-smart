"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Picture } from "@/components/brand/media";
import { Wordmark } from "@/components/shell/logo";
import { useSession } from "@/lib/sb/session";
import { cn } from "@/lib/utils";

export const SEEN_KEY = "horbit-apresentacao";

const SLIDES = [
  {
    img: "/onboarding/1.webp",
    title: "Marque o ponto em segundos",
    text: "Leia o QR Code da recepção com o telemóvel. O Horbit confirma a hora e se está dentro do local de trabalho.",
    alt: "Telemóvel a ler o QR Code da estação, com a entrada registada",
  },
  {
    img: "/onboarding/2.webp",
    title: "Faltas justificadas sem papel",
    text: "Envie a fotografia do atestado. O supervisor e o RH decidem no painel, sempre com o fundamento.",
    alt: "Pedido de justificação de falta com anexo, no telemóvel",
  },
  {
    img: "/onboarding/3.webp",
    title: "Salários e recibos no fim do mês",
    text: "A assiduidade do mês dá os salários. Outra pessoa aprova e o recibo chega ao seu telemóvel.",
    alt: "Recibo de vencimento do mês no telemóvel",
  },
];

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
}

/** Apresentação ao abrir a aplicação: ecrã da marca, três passos e depois entrar ou pedir conta. */
export function Onboarding() {
  const router = useRouter();
  const { state } = useSession();
  const [splash, setSplash] = React.useState(true);
  const [i, setI] = React.useState(0);
  const touch = React.useRef<number | null>(null);
  const last = i === SLIDES.length - 1;

  React.useEffect(() => {
    // Basta ver a apresentação uma vez: o login não volta a redireccionar para aqui.
    markSeen();
    const t = setTimeout(() => setSplash(false), 1400);
    return () => clearTimeout(t);
  }, []);

  // Já com sessão: segue directamente para a área da pessoa.
  React.useEffect(() => {
    if (state.status === "ready") router.replace("/inicio/");
  }, [state.status, router]);

  const go = React.useCallback((n: number) => setI(Math.max(0, Math.min(SLIDES.length - 1, n))), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  if (splash) {
    return (
      <button
        type="button"
        onClick={() => setSplash(false)}
        className="flex min-h-dvh w-full cursor-default flex-col items-center justify-center bg-primary text-white"
        aria-label="Continuar"
      >
        <Wordmark className="h-12 sm:h-14" color="#ffffff" />
        <span className="mt-4 text-[14px] font-medium text-white/75">Ponto, assiduidade e salários</span>
      </button>
    );
  }

  const s = SLIDES[i];
  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-[#16131f] text-white"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (dx < -50) go(i + 1);
        if (dx > 50) go(i - 1);
        touch.current = null;
      }}
    >
      {/* Haste violeta no bordo direito, com o botão de avançar encaixado. */}
      <div aria-hidden className="absolute inset-y-0 right-0 w-1.5 bg-primary" />

      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 pt-6 pb-8 pr-10 lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:px-12">
        <div className="flex items-center justify-between lg:absolute lg:inset-x-12 lg:top-8 lg:mx-auto lg:max-w-5xl">
          <Wordmark className="h-6" color="#ffffff" />
          {last ? null : (
            <Link href="/login/" onClick={markSeen} className="rounded-md px-3 py-2 text-[13.5px] font-bold text-white/60 hover:text-white">
              Saltar
            </Link>
          )}
        </div>

        <div className="mt-6 lg:mt-0">
          <Picture
            key={s.img}
            src={s.img}
            alt={s.alt}
            width={1080}
            height={1080}
            priority
            className="mx-auto aspect-square h-auto w-full max-w-[460px] rounded-2xl bg-primary object-cover"
          />
        </div>

        <div className="mt-8 flex flex-1 flex-col lg:mt-0 lg:flex-none">
          <p className="text-[13px] font-bold text-white/50 tabular">
            {i + 1} de {SLIDES.length}
          </p>
          <h1 className="mt-2 text-[30px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[38px]">{s.title}</h1>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/65">{s.text}</p>

          <div className="mt-auto pt-8 lg:mt-10">
            <div className="flex gap-1.5" aria-hidden>
              {SLIDES.map((_, j) => (
                <span key={j} className={cn("h-1 w-7 rounded-full transition-colors", j === i ? "bg-primary" : "bg-white/20")} />
              ))}
            </div>
            {last ? (
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                <Link
                  href="/login/"
                  onClick={markSeen}
                  className="flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-[15px] font-bold text-white hover:bg-primary-hover"
                >
                  Entrar
                </Link>
                <Link
                  href="/registo/"
                  onClick={markSeen}
                  className="flex h-12 items-center justify-center rounded-lg border border-white/25 px-6 text-[15px] font-bold text-white hover:border-white/60"
                >
                  Pedir acesso para a empresa
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {last ? null : (
        <button
          type="button"
          onClick={() => go(i + 1)}
          aria-label="Seguinte"
          className="absolute right-0 bottom-24 flex h-16 w-11 items-center justify-center rounded-l-full bg-primary text-[26px] leading-none font-bold text-white hover:bg-primary-hover lg:top-1/2 lg:bottom-auto lg:-translate-y-1/2"
        >
          <span className="-mt-0.5 ml-1">›</span>
        </button>
      )}
      {i > 0 ? (
        <button
          type="button"
          onClick={() => go(i - 1)}
          className="absolute bottom-8 left-6 hidden rounded-md px-2 py-1 text-[13px] font-bold text-white/50 hover:text-white lg:block"
        >
          Anterior
        </button>
      ) : null}
    </div>
  );
}
