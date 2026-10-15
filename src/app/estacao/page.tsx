"use client";

import { Loader2, Maximize, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { errorMessage, rpc, sb } from "@/lib/sb/client";
import { useSession } from "@/lib/sb/session";

type QrResponse = { token: string; expiresAt: string; ttl: number; station: string; location: string | null };
type QrState = { svg: string; ttl: number; refreshIn: number; issuedAt: number; station: string; location: string | null };
type StationRow = { id: string; company_id: string; name: string; qr_mode: "dynamic" | "static"; active: boolean };

export default function StationPage() {
  return (
    <React.Suspense fallback={<Centered><Loader2 className="size-6 animate-spin text-primary" aria-label="A carregar" /></Centered>}>
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
        <LogoMark className="mx-auto size-10" />
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="text-[13px] text-muted">{message}</p>
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
    document.title = station ? `${station.name} · Estação · PontoSmart` : "Estação de marcação · PontoSmart";
  }, [station]);

  if (state.status === "error") return <Problem title="Não foi possível abrir a sua conta" message={state.message} />;
  if (state.status !== "ready" || !me) return <Centered><Loader2 className="size-6 animate-spin text-primary" aria-label="A carregar" /></Centered>;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return <Problem title="Estação inválida" message="Abra o ecrã a partir de Locais e estações." />;
  if (loadError) return <Problem title="Não foi possível carregar a estação" message={loadError} />;
  if (station === undefined) return <Centered><Loader2 className="size-6 animate-spin text-primary" aria-label="A carregar" /></Centered>;
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
    <div className="flex min-h-dvh flex-col bg-background p-5 sm:p-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold">{company}</p>
            <p className="truncate text-sm text-muted">{qr ? [qr.station, qr.location].filter(Boolean).join(" · ") : "Estação de marcação"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          className="cursor-pointer rounded-md p-2 text-muted hover:bg-surface"
          aria-label="Ecrã inteiro"
        >
          <Maximize className="size-5" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-8 lg:flex-row lg:gap-20">
        <div className="relative">
          <div className="rounded-[28px] border border-border bg-white p-5 shadow-panel sm:p-7">
            {qr ? (
              <div className="size-[min(72vw,420px)] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} aria-label="QR Code de marcação de ponto" role="img" />
            ) : (
              <div className="size-[min(72vw,420px)] animate-pulse rounded-xl bg-surface-2" />
            )}
          </div>
          <div className="mx-auto mt-5 h-1.5 w-2/3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-2 text-center text-xs text-muted tabular">{qr ? `Novo código em ${Math.ceil(remaining)} s` : "A gerar código…"}</p>
        </div>

        <div className="max-w-sm text-center lg:text-left">
          <p className="text-[64px] leading-none font-semibold tracking-tight tabular sm:text-[88px]">
            {time.slice(0, 5)}
            <span className="text-[0.45em] text-subtle">{time.slice(5)}</span>
          </p>
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
            <p className="mt-6 inline-flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-left text-sm text-danger">
              <WifiOff className="size-4 shrink-0" /> {error}
            </p>
          ) : null}
        </div>
      </main>
      <footer className="text-center text-xs text-subtle">A hora de marcação é a do servidor. O código só é válido por poucos segundos.</footer>
    </div>
  );
}
