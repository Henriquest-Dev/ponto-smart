"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { withBase } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";
import { Orbi, type OrbiApi } from "./orbi";

/** Olho interactivo do assistente: segue o cursor e o dedo, pensa enquanto a IA responde e pisca. */
export const OrbiEye = React.forwardRef<OrbiApi | null, { size?: number; thinking?: boolean; className?: string; label?: string }>(function OrbiEye(
  { size = 120, thinking = false, className, label = "Orbi, o assistente do Horbit" },
  ref,
) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const api = React.useRef<OrbiApi | null>(null);
  // Cria a mascote uma só vez por canvas (evita dois olhos a piscar ao mesmo tempo).
  React.useEffect(() => {
    if (!canvas.current) return;
    const o = Orbi(canvas.current);
    api.current = o;
    return () => {
      o.destroy();
      api.current = null;
    };
  }, [size]);
  React.useEffect(() => {
    api.current?.setThinking(thinking);
  }, [thinking]);
  React.useImperativeHandle(ref, () => ({
    setThinking: (v) => api.current?.setThinking(v),
    lookAt: (el) => api.current?.lookAt(el),
    follow: (el) => api.current?.follow(el),
    blink: () => api.current?.blink(),
    setTalking: (v) => api.current?.setTalking(v),
    setListening: (v) => api.current?.setListening(v),
    kick: (n) => api.current?.kick(n),
    destroy: () => api.current?.destroy(),
  }));
  // Resolução interna em dobro para ficar nítido em ecrãs de alta densidade.
  return <canvas ref={canvas} width={size * 2} height={size * 2} style={{ width: size, height: size }} className={cn("block select-none", className)} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} />;
});

/** Safari não reproduz WebM com transparência: aí usa-se o olho desenhado. */
function webmAlphaOk() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua);
  return !safari && !ios && document.createElement("video").canPlayType('video/webm; codecs="vp9"') !== "";
}

/** Vídeo do Orbi (6 s em loop, fundo transparente) para sítios sem interacção: carregamento e avatar. */
export function OrbiVideo({ size = 96, className, label = "Orbi, o assistente do Horbit" }: { size?: number; className?: string; label?: string }) {
  const [ok, setOk] = React.useState<boolean | null>(null);
  React.useEffect(() => setOk(webmAlphaOk()), []);
  if (ok === null) return <span style={{ width: size, height: size }} className={cn("inline-block", className)} aria-hidden />;
  if (!ok) return <OrbiEye size={size} className={className} label={label} />;
  return (
    <video
      src={withBase("/media/orbi-olho-transparente.webm")}
      autoPlay
      loop
      muted
      playsInline
      width={size}
      height={size}
      // O olho ocupa só o centro do vídeo: amplia-se um pouco para ter o mesmo tamanho do olho desenhado.
      style={{ width: size, height: size, transform: "scale(1.3)" }}
      className={cn("block", className)}
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/** Botão flutuante do assistente: o olho a olhar por nós em todas as páginas da gestão. */
export function AssistantFab({ href }: { href: string }) {
  const pathname = usePathname();
  if (pathname.startsWith(href)) return null;
  return (
    <Link
      href={`${href}?voz=1`}
      aria-label="Falar com o Orbi, o assistente"
      title="Assistente"
      className="group fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex size-16 items-center justify-center rounded-full bg-background shadow-[0_12px_32px_-10px_rgb(52_27_140/0.55)] ring-1 ring-primary/20 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:right-6 lg:bottom-6"
    >
      <OrbiEye size={52} label="" />
    </Link>
  );
}
