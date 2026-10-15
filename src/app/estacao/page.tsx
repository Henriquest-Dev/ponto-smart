"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { useSession } from "@/lib/sb/session";

type QrResponse = { token: string; expiresAt: string; ttl: number; station: string; location: string | null };
type QrState = { svg: string; ttl: number; refreshIn: number; issuedAt: number; station: string; location: string | null };
const STEPS = ["Abra o Horbit e toque em Marcar ponto.", "Aponte a câmara a este código.", "Aguarde a confirmação no telemóvel."];

type StationRow = { id: string; company_id: string; name: string; qr_mode: "dynamic" | "static"; active: boolean };

export default function StationPage() {
  return (
    <React.Suspense fallback={<Centered><span className="spinner text-[28px] text-primary" role="status" aria-label="A carregar" /></Centered>}>
      <StationGate />
    </React.Suspense>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-center">{children}</div>;
}

function Problem({ title, message }: { title: string; message: string }) {
  return (
    <Centered>
      <div className="max-w-sm space-y-4">
        <Wordmark className="mx-auto mb-8 h-9" />
        <p className="text-[22px] leading-tight font-bold tracking-[-0.02em]">{title}</p>
        <p className="text-[14px] leading-relaxed text-muted">{message}</p>
        <Button asChild variant="outline">
          <Link href="/empresa/locais/">Voltar aos locais</Link>
        </Button>
      </div>
    </Centered>
  );
}

/** Confirma a sessão (sem o shell das áreas) e a estação pedida em ?id=. */
function StationGate() {
  const { state, me } = useSession();
  const router = useRouter();
  const id = useSearchParams().get("id");

  React.useEffect(() => {
    if (state.status === "anon" || state.status === "mfa") {
      const next = `/estacao/${id ? `?id=${encodeURIComponent(id)}` : ""}`;
      router.replace(`/login/?next=${encodeURIComponent(next)}`);
    }
  }, [state.status, id, router]);

  const [station, setStation] = React.useState<StationRow | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state.status !== "ready" || !id) return;
    let alive = true;
    sb()
      .from("attendance_stations")
      .select("id,company_id,name,qr_mode,active")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setLoadError(errorMessage(error));
        else setStation((data as StationRow | null) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [state.status, id]);

  React.useEffect(() => {
    document.title = station ? `${station.name}, estação de marcação | Horbit` : "Estação de marcação | Horbit";
  }, [station]);

  if (state.status === "error") return <Problem title="Não foi possível abrir a sua conta" message={state.message} />;
  if (state.status !== "ready" || !me) return <Centered><span className="spinner text-[28px] text-primary" role="status" aria-label="A carregar" /></Centered>;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return <Problem title="Estação inválida" message="Abra o ecrã a partir de Locais e estações." />;
  if (loadError) return <Problem title="Não foi possível carregar a estação" message={loadError} />;
  if (station === undefined) return <Centered><span className="spinner text-[28px] text-primary" role="status" aria-label="A carregar" /></Centered>;
  if (station === null) return <Problem title="Estação não encontrada" message="A estação não existe ou não pertence a nenhuma das suas empresas." />;
  if (!station.active) return <Problem title="Estação inactiva" message="Active a estação em Locais e estações para mostrar o código." />;
  if (station.qr_mode !== "dynamic") return <Problem title="Estação com QR fixo" message="Esta estação usa um QR impresso. Gere-o em Locais e estações." />;

  const membership = me.memberships.find((m) => m.companyId === station.company_id);
  if (!membership?.permissions.includes("stations.display")) {
    return <Problem title="Sem permissão" message="O seu papel não permite abrir ecrãs de marcação nesta empresa." />;
  }
  return <StationDisplay stationId={station.id} company={membership.companyName} timeZone={membership.timezone} />;
}

function StationDisplay({ stationId, company, timeZone }: { stationId: string; company: string; timeZone: string }) {
  const [qr, setQr] = React.useState<QrState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = React.useRef(true);
  const reduce = useReducedMotion();
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const load = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const r = await rpc<QrResponse>("ps_station_qr", { p_station: stationId });
      const QRCode = (await import("qrcode")).default;
      const svg = await QRCode.toString(r.token, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      if (!alive.current) return;
      const ttl = Math.max(10, Number(r.ttl) || 30);
      // Renova uns segundos antes de expirar, para o código no ecrã ser sempre válido.
      const refreshIn = Math.max(5, ttl - 5);
      setQr({ svg, ttl, refreshIn, issuedAt: Date.now(), station: r.station, location: r.location });
      setError(null);
      timer.current = setTimeout(load, refreshIn * 1000);
    } catch (e) {
      if (!alive.current) return;
      const msg = e instanceof Error ? e.message : errorMessage(e);
      setError(/internet|failed to fetch|network/i.test(msg) ? "Sem ligação ao servidor. A tentar novamente…" : `${msg} A tentar novamente…`);
      setQr(null);
      timer.current = setTimeout(load, 5000);
    }
  }, [stationId]);

  React.useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => setNow(Date.now()), 250);

    // Mantém o ecrã ligado (quando suportado) e recupera o bloqueio ao voltar ao separador.
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    const acquire = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void acquire();
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [load]);

  const remaining = qr ? Math.max(0, qr.refreshIn - (now - qr.issuedAt) / 1000) : 0;
  const progress = qr ? remaining / qr.refreshIn : 0;
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(now));
  const date = new Intl.DateTimeFormat("pt-PT", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(now));

  return (
    <div className="flex min-h-dvh flex-col bg-foreground px-5 py-6 text-background sm:px-10 sm:py-8 lg:px-14">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-5">
          <Wordmark color="var(--background)" className="h-8 shrink-0 sm:h-10" />
          <span className="hidden h-9 w-[3px] shrink-0 rounded-full bg-background/20 sm:block" aria-hidden />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-[17px] font-bold tracking-[-0.01em]">{company}</p>
            <p className="truncate text-[14px] font-medium text-background/60">
              {qr ? [qr.station, qr.location].filter(Boolean).join(", ") : "Estação de marcação"}
            </p>
          </div>
        </div>
        {!fullscreen ? (
          <button
            type="button"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="h-10 shrink-0 cursor-pointer rounded-full border-2 border-background/20 px-4 text-[13px] font-bold text-background/80 transition-colors hover:border-background/60 hover:text-background"
          >
            Ecrã inteiro
          </button>
        ) : null}
      </header>
      <div className="mt-3 min-w-0 sm:hidden">
        <p className="truncate text-[16px] font-bold">{company}</p>
        <p className="truncate text-[13px] text-background/60">{qr ? [qr.station, qr.location].filter(Boolean).join(", ") : "Estação de marcação"}</p>
      </div>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 py-8 lg:flex-row lg:justify-between lg:gap-16">
        <div className="w-full max-w-xl text-center lg:text-left">
          <p className="text-[clamp(76px,13vw,176px)] leading-[0.9] font-bold tracking-[-0.045em] tabular">
            {time.slice(0, 5)}
            <span className="ml-1 text-[0.38em] tracking-[-0.02em] text-background/35">{time.slice(5)}</span>
          </p>
          <p className="mt-4 text-[clamp(18px,2.2vw,26px)] font-bold text-background/70 first-letter:uppercase">{date}</p>

          <ol className="mx-auto mt-10 max-w-md space-y-4 text-left lg:mx-0">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-4">
                <span className="stem text-primary" aria-hidden />
                <span className="w-6 shrink-0 text-[26px] leading-none font-bold text-background/40 tabular">{i + 1}</span>
                <span className="text-[clamp(16px,1.8vw,21px)] font-bold">{s}</span>
              </li>
            ))}
          </ol>

          {error ? (
            <p role="alert" className="mx-auto mt-8 inline-flex items-center gap-3 rounded-lg bg-danger px-5 py-3 text-left text-[15px] font-bold text-white lg:mx-0">
              <span className="stem" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-center">
          <div className="rounded-xl bg-background p-5 text-foreground sm:p-7">
            <div className="relative size-[min(78vw,46vh,560px)] lg:size-[min(40vw,64vh,600px)]">
              <AnimatePresence initial={false}>
                {qr ? (
                  <motion.div
                    key={qr.issuedAt}
                    className="absolute inset-0 [&_svg]:size-full"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
                    transition={{ duration: reduce ? 0.15 : 0.45, ease: [0.22, 1, 0.36, 1] }}
                    dangerouslySetInnerHTML={{ __html: qr.svg }}
                    aria-label="QR Code de marcação de ponto"
                    role="img"
                  />
                ) : (
                  <motion.div
                    key="loading"
                    className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="spinner text-[32px] text-primary" aria-hidden />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="mt-6 w-full">
            <div className="h-3.5 w-full overflow-hidden rounded-full bg-background/15" aria-hidden>
              {qr ? (
                reduce ? (
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
                ) : (
                  <motion.div
                    key={qr.issuedAt}
                    className="h-full origin-left rounded-full bg-primary"
                    initial={{ scaleX: progress }}
                    animate={{ scaleX: 0 }}
                    transition={{ duration: remaining, ease: "linear" }}
                  />
                )
              ) : null}
            </div>
            <p className="mt-3 text-center text-[15px] font-bold text-background/70 tabular" aria-live="off">
              {qr ? (
                <>
                  Novo código em <span className="text-background">{Math.ceil(remaining)} s</span>
                </>
              ) : (
                "A gerar código"
              )}
            </p>
          </div>
        </div>
      </main>

      <footer className="text-center text-[13px] font-medium text-background/45 lg:text-left">
        A hora de marcação é a do servidor. Cada código só é válido durante poucos segundos.
      </footer>
    </div>
  );
}
