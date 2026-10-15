"use client";

import { Maximize, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/shell/logo";

type QrState = { svg: string; rotateInSeconds: number; issuedAt: number };

export function StationDisplay({ stationId, name, location, company, timeZone }: { stationId: string; name: string; location: string; company: string; timeZone: string }) {
  const [qr, setQr] = useState<QrState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stations/${stationId}/qr`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Erro");
      setQr({ svg: json.svg, rotateInSeconds: json.rotateInSeconds, issuedAt: Date.now() });
      setError(null);
      timer.current = setTimeout(load, json.rotateInSeconds * 1000);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sem ligação ao servidor. A tentar novamente…");
      timer.current = setTimeout(load, 5000);
    }
  }, [stationId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => setNow(Date.now()), 250);
    // Mantém o ecrã ligado (quando suportado).
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
      void lock?.release();
    };
  }, [load]);

  const remaining = qr ? Math.max(0, qr.rotateInSeconds - (now - qr.issuedAt) / 1000) : 0;
  const progress = qr ? remaining / qr.rotateInSeconds : 0;
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(now));
  const date = new Intl.DateTimeFormat("pt-PT", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(now));

  return (
    <div className="flex min-h-dvh flex-col bg-background p-5 sm:p-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <p className="text-[17px] font-semibold">{company}</p>
            <p className="text-sm text-muted">{name} · {location}</p>
          </div>
        </div>
        <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-md p-2 text-muted hover:bg-surface" aria-label="Ecrã inteiro">
          <Maximize className="size-5" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-8 lg:flex-row lg:gap-20">
        <div className="relative">
          <div className="rounded-[28px] border border-border bg-background p-5 shadow-panel sm:p-7">
            {qr ? (
              <div className="size-[min(72vw,420px)] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} aria-label="QR Code de marcação de ponto" role="img" />
            ) : (
              <div className="size-[min(72vw,420px)] animate-pulse rounded-xl bg-surface-2" />
            )}
          </div>
          <div className="mx-auto mt-5 h-1.5 w-2/3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-2 text-center text-xs text-muted tabular">Novo código em {Math.ceil(remaining)} s</p>
        </div>

        <div className="max-w-sm text-center lg:text-left">
          <p className="text-[64px] leading-none font-semibold tracking-tight tabular sm:text-[88px]">{time.slice(0, 5)}<span className="text-[0.45em] text-subtle">{time.slice(5)}</span></p>
          <p className="mt-2 text-lg text-muted first-letter:uppercase">{date}</p>
          <ol className="mt-8 space-y-3 text-left text-[15px]">
            {["Abra o PontoSmart no telemóvel e toque em Marcar ponto.", "Aponte a câmara para este código.", "Autorize a localização e aguarde a confirmação."].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          {error ? (
            <p className="mt-6 inline-flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <WifiOff className="size-4" /> {error}
            </p>
          ) : null}
        </div>
      </main>
      <footer className="text-center text-xs text-subtle">A hora de marcação é a do servidor. O código só é válido por poucos segundos.</footer>
    </div>
  );
}
