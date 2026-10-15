"use client";

import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Clock, Loader2, LocateFixed, MapPinOff, RotateCcw, ScanLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { getDeviceKey } from "@/lib/client/device";
import { extractQrToken } from "@/lib/domain/qr-client";
import { cn } from "@/lib/utils";

type Step = "intro" | "scanning" | "locating" | "submitting" | "result";
type Fix = { latitude: number; longitude: number; accuracy: number } | null;
type ClockResponse =
  | {
      ok: true;
      result: {
        type: "in" | "out" | "break_start" | "break_end";
        status: "accepted" | "review" | "rejected";
        occurredAt: string;
        geofence: string;
        message: string;
        duplicate: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string } };

const TYPE_LABEL = { in: "Entrada", out: "Saída", break_start: "Início de intervalo", break_end: "Fim de intervalo" };

export function ClockFlow({
  initialToken,
  state,
  wantsBreak,
  timeZone,
  devicePolicy,
}: {
  initialToken: string | null;
  state: "off" | "working" | "break";
  wantsBreak: boolean;
  timeZone: string;
  devicePolicy: "off" | "warn" | "require";
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialToken ? "locating" : "intro");
  const [token, setToken] = useState<string | null>(initialToken);
  const [fix, setFix] = useState<Fix>(null);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [response, setResponse] = useState<ClockResponse | null>(null);
  const [note, setNote] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idemRef = useRef<string>(crypto.randomUUID());
  const inflightRef = useRef(false);

  const action = wantsBreak ? "Iniciar intervalo" : state === "off" ? "Entrada" : state === "break" ? "Fim de intervalo" : "Saída";

  /* --------------------------- Câmara + QR --------------------------- */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (step !== "scanning") return;
    let cancelled = false;
    let raf = 0;
    let last = 0;
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const jsQR = (await import("jsqr")).default;
        const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

        const tick = async (t: number) => {
          if (cancelled) return;
          if (t - last > 140 && video.readyState >= 2) {
            last = t;
            let raw: string | null = null;
            try {
              if (detector) {
                const codes = await detector.detect(video);
                raw = codes[0]?.rawValue ?? null;
              } else if (g) {
                const w = video.videoWidth;
                const h = video.videoHeight;
                const size = Math.min(w, h);
                canvas.width = 640;
                canvas.height = 640;
                g.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 640, 640);
                const img = g.getImageData(0, 0, 640, 640);
                raw = jsQR(img.data, 640, 640, { inversionAttempts: "dontInvert" })?.data ?? null;
              }
            } catch {
              /* frame ignorado */
            }
            if (raw) {
              const parsed = extractQrToken(raw);
              if (parsed) {
                if (navigator.vibrate) navigator.vibrate(40);
                stopCamera();
                setToken(parsed);
                setStep("locating");
                return;
              }
              setCamError("Este QR Code não é de uma estação PontoSmart.");
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setCamError(
          name === "NotAllowedError"
            ? "Sem permissão para usar a câmara. Autorize o acesso nas definições do navegador."
            : "Não foi possível abrir a câmara neste dispositivo.",
        );
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [step, stopCamera]);

  /* --------------------------- Localização --------------------------- */
  useEffect(() => {
    if (step !== "locating") return;
    if (!("geolocation" in navigator)) {
      setGeoError("Este navegador não suporta localização.");
      return;
    }
    setGeoError(null);
    setLiveAccuracy(null);
    let best: GeolocationPosition | null = null;
    let done = false;
    const finish = (pos: GeolocationPosition | null) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      setFix(pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy } : null);
      setStep("submitting");
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        setLiveAccuracy(Math.round(pos.coords.accuracy));
        // Precisão suficiente: não esperar mais.
        if (pos.coords.accuracy <= 20) finish(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Sem permissão de localização. A marcação pode ser enviada para revisão.");
        } else if (!best) {
          setGeoError("Não foi possível obter a localização.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    // Aguarda no máximo ~9 s pela melhor leitura disponível.
    const timer = setTimeout(() => finish(best), 9000);
    return () => {
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
    };
  }, [step]);

  /* ----------------------------- Envio ------------------------------ */
  const submit = useCallback(
    async (opts?: { requestReview?: boolean }) => {
      if (!token || inflightRef.current) return;
      inflightRef.current = true;
      setStep("submitting");
      try {
        const res = await fetch("/api/attendance/clock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            latitude: fix?.latitude ?? null,
            longitude: fix?.longitude ?? null,
            accuracy: fix?.accuracy ?? null,
            deviceKey: devicePolicy === "off" ? null : getDeviceKey(),
            idempotencyKey: idemRef.current,
            requested: wantsBreak ? "break_start" : null,
            requestReview: opts?.requestReview ?? false,
            reviewNote: opts?.requestReview ? note : null,
          }),
        });
        const json = (await res.json()) as ClockResponse;
        setResponse(json);
        setStep("result");
        if (json.ok && json.result.status !== "rejected") router.refresh();
      } catch {
        setResponse({ ok: false, error: { code: "network", message: "Sem ligação. Verifique a internet e tente novamente." } });
        setStep("result");
      } finally {
        inflightRef.current = false;
      }
    },
    [token, fix, devicePolicy, wantsBreak, note, router],
  );

  useEffect(() => {
    if (step === "submitting" && !response && !inflightRef.current) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const restart = () => {
    idemRef.current = crypto.randomUUID();
    setResponse(null);
    setToken(null);
    setFix(null);
    setCamError(null);
    setStep("scanning");
  };

  const requestReview = () => {
    idemRef.current = crypto.randomUUID();
    void submit({ requestReview: true }).then(() => undefined);
  };

  /* ----------------------------- Render ----------------------------- */
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-md flex-col px-4 py-5 sm:py-8">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/app" className="rounded-md p-1.5 text-muted hover:bg-surface" aria-label="Voltar">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Marcar ponto</h1>
          <p className="text-[13px] text-muted">Próxima marcação: {action}</p>
        </div>
      </div>

      <Steps step={step} />

      {step === "intro" ? (
        <div className="mt-6 flex flex-1 flex-col">
          <div className="rounded-2xl border border-border bg-surface/60 p-6 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <ScanLine className="size-8" />
            </div>
            <p className="mt-4 text-[15px] font-semibold">Leia o QR Code da estação</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Aponte a câmara para o código apresentado no ecrã da recepção ou portaria. O código muda a cada poucos segundos.
            </p>
          </div>
          <ul className="mt-5 space-y-3 text-[13px] text-muted">
            <li className="flex gap-3">
              <LocateFixed className="mt-0.5 size-4 shrink-0 text-primary" />
              A localização é pedida apenas neste momento, para confirmar que está no local de trabalho. Não há rastreio contínuo.
            </li>
            <li className="flex gap-3">
              <Clock className="mt-0.5 size-4 shrink-0 text-primary" />A hora registada é a do servidor, não a do telemóvel.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              Se o GPS estiver impreciso, a marcação fica em revisão — nunca é tratada como fraude.
            </li>
          </ul>
          <Button size="lg" className="mt-auto w-full" onClick={() => setStep("scanning")}>
            <Camera /> Abrir câmara
          </Button>
        </div>
      ) : null}

      {step === "scanning" ? (
        <div className="mt-6 flex flex-1 flex-col">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[#0d0e16]">
            <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />
            <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgb(13_14_22/0.45)]">
              <div className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-primary/80" />
            </div>
          </div>
          {camError ? (
            <Notice tone="warning" className="mt-4">
              {camError}
            </Notice>
          ) : (
            <p className="mt-4 text-center text-[13px] text-muted">A procurar QR Code…</p>
          )}
          <Button variant="outline" size="lg" className="mt-auto w-full" onClick={() => setStep("intro")}>
            Cancelar
          </Button>
        </div>
      ) : null}

      {step === "locating" ? (
        <div className="mt-10 flex flex-1 flex-col items-center text-center">
          <div className="relative flex size-24 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
            <span className="relative flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary">
              <LocateFixed className="size-7" />
            </span>
          </div>
          <p className="mt-6 text-[15px] font-semibold">A obter localização</p>
          <p className="mt-1 text-[13px] text-muted">
            {liveAccuracy ? `Precisão actual: ±${liveAccuracy} m` : "Autorize o acesso à localização quando o navegador pedir."}
          </p>
          {geoError ? (
            <Notice tone="warning" className="mt-5 w-full text-left">
              {geoError}
            </Notice>
          ) : null}
          <Button variant="ghost" className="mt-auto" onClick={() => setStep("submitting")}>
            Continuar sem esperar
          </Button>
        </div>
      ) : null}

      {step === "submitting" ? (
        <div className="mt-16 flex flex-1 flex-col items-center text-center">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="mt-5 text-[15px] font-semibold">A validar no servidor</p>
          <p className="mt-1 text-[13px] text-muted">QR Code, perímetro e dispositivo</p>
        </div>
      ) : null}

      {step === "result" && response ? (
        <Result
          response={response}
          timeZone={timeZone}
          fix={fix}
          note={note}
          setNote={setNote}
          onRetry={restart}
          onReview={requestReview}
        />
      ) : null}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["scanning", "locating", "submitting", "result"];
  const idx = step === "intro" ? -1 : order.indexOf(step);
  const labels = ["QR Code", "Localização", "Validação"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progresso">
      {labels.map((l, i) => (
        <li key={l}>
          <div className={cn("h-1 rounded-full", i < idx || idx === 3 ? "bg-primary" : i === idx ? "bg-primary/50" : "bg-surface-2")} />
          <p className={cn("mt-1.5 text-[11px]", i <= idx ? "text-foreground" : "text-subtle")}>{l}</p>
        </li>
      ))}
    </ol>
  );
}

function Result({
  response,
  timeZone,
  fix,
  note,
  setNote,
  onRetry,
  onReview,
}: {
  response: ClockResponse;
  timeZone: string;
  fix: Fix;
  note: string;
  setNote: (v: string) => void;
  onRetry: () => void;
  onReview: () => void;
}) {
  if (!response.ok) {
    return (
      <div className="mt-10 flex flex-1 flex-col items-center text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-danger-soft text-danger">
          <AlertTriangle className="size-8" />
        </span>
        <p className="mt-5 text-[17px] font-semibold">Marcação não registada</p>
        <p className="mt-1.5 max-w-xs text-[13px] text-muted">{response.error.message}</p>
        <Button size="lg" className="mt-auto w-full" onClick={onRetry}>
          <RotateCcw /> Ler QR Code novamente
        </Button>
      </div>
    );
  }
  const r = response.result;
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(r.occurredAt));

  if (r.status === "rejected") {
    return (
      <div className="mt-8 flex flex-1 flex-col">
        <div className="text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning">
            <MapPinOff className="size-8" />
          </span>
          <p className="mt-5 text-[17px] font-semibold">Fora do perímetro</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-muted">{r.message}</p>
          {fix ? <p className="mt-1 text-xs text-subtle">Precisão do GPS: ±{Math.round(fix.accuracy)} m</p> : null}
        </div>
        <div className="mt-6 space-y-2">
          <label htmlFor="note" className="text-[13px] font-medium">
            Está no local? Explique e peça revisão
          </label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: estou no armazém lateral, o sinal GPS é fraco." maxLength={300} />
        </div>
        <div className="mt-auto grid gap-2 pt-6">
          <Button size="lg" onClick={onRetry}>
            <RotateCcw /> Tentar novamente
          </Button>
          <Button size="lg" variant="outline" onClick={onReview} disabled={note.trim().length < 5}>
            Pedir revisão
          </Button>
        </div>
      </div>
    );
  }

  const ok = r.status === "accepted";
  return (
    <div className="mt-10 flex flex-1 flex-col items-center text-center">
      <span className={cn("flex size-20 items-center justify-center rounded-full", ok ? "bg-success-soft text-success" : "bg-primary-soft text-primary")}>
        {ok ? <CheckCircle2 className="size-10" /> : <Clock className="size-10" />}
      </span>
      <p className="mt-5 text-[13px] text-muted">{TYPE_LABEL[r.type]}</p>
      <p className="text-[44px] leading-tight font-semibold tracking-tight tabular">{time}</p>
      <Badge tone={ok ? "success" : "primary"} className="mt-2">
        {ok ? "Marcação validada" : "Em revisão"}
      </Badge>
      <p className="mt-4 max-w-xs text-[13px] text-muted">{r.message}</p>
      <Button size="lg" className="mt-auto w-full" asChild>
        <Link href="/app">Concluir</Link>
      </Button>
    </div>
  );
}
