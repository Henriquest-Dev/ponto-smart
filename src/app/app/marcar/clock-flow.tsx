"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { ScanFrame, StemLoader, StemSteps, ThickBar } from "@/components/collab/motion";
import { getDeviceKey } from "@/lib/client/device";
import { extractQrToken } from "@/lib/domain/qr-client";
import { rpc } from "@/lib/sb/client";
import { cn } from "@/lib/utils";

type Step = "intro" | "scanning" | "locating" | "submitting" | "result";
type Fix = { latitude: number; longitude: number; accuracy: number } | null;
/** Resultado de `ps_clock`. */
type ClockResult = {
  eventId: string;
  type: "in" | "out" | "break_start" | "break_end";
  status: "accepted" | "review" | "rejected";
  occurredAt: string;
  geofence: string;
  device: string;
  message: string;
  duplicate: boolean;
  distanceM?: number | null;
  location?: string | null;
};
type ClockResponse = { ok: true; result: ClockResult } | { ok: false; error: { message: string } };

const newKey = () => crypto.randomUUID();

const TYPE_LABEL = { in: "Entrada", out: "Saída", break_start: "Início de intervalo", break_end: "Fim de intervalo" };

export function ClockFlow({
  initialToken,
  state,
  wantsBreak,
  timeZone,
  devicePolicy,
}: {
  initialToken: string | null;
  state: "off" | "working" | "break" | null;
  wantsBreak: boolean;
  timeZone: string;
  devicePolicy: "off" | "warn" | "require";
}) {
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
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const idemRef = useRef<string | null>(null);
  const inflightRef = useRef(false);

  const action =
    state === null ? "…" : wantsBreak ? "Iniciar intervalo" : state === "off" ? "Entrada" : state === "break" ? "Fim de intervalo" : "Saída";

  const applyCode = () => {
    const parsed = extractQrToken(code);
    if (!parsed) {
      setCodeError("Código inválido. Copie o código completo apresentado na estação (começa por ps1.).");
      return;
    }
    setCodeError(null);
    setManual(false);
    setCode("");
    setToken(parsed);
    setStep("locating");
  };

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
              setCamError("Este QR Code não é de uma estação Horbit.");
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
        idemRef.current ??= newKey();
        const result = await rpc<ClockResult>("ps_clock", {
          p_token: token,
          p_lat: fix?.latitude ?? null,
          p_lng: fix?.longitude ?? null,
          p_accuracy: fix?.accuracy ?? null,
          p_idempotency: idemRef.current,
          p_device_key: devicePolicy === "off" ? null : getDeviceKey(),
          p_requested: wantsBreak ? "break_start" : null,
          p_request_review: opts?.requestReview ?? false,
          p_note: opts?.requestReview ? note.trim() : null,
        });
        setResponse({ ok: true, result });
        setStep("result");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sem ligação. Verifique a internet e tente novamente.";
        setResponse({ ok: false, error: { message } });
        setStep("result");
      } finally {
        inflightRef.current = false;
      }
    },
    [token, fix, devicePolicy, wantsBreak, note],
  );

  useEffect(() => {
    if (step === "submitting" && !response && !inflightRef.current) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const restart = () => {
    idemRef.current = newKey();
    setResponse(null);
    setToken(null);
    setFix(null);
    setCamError(null);
    setStep("scanning");
  };

  const requestReview = () => {
    idemRef.current = newKey();
    void submit({ requestReview: true }).then(() => undefined);
  };

  /* ----------------------------- Render ----------------------------- */
  const stepIdx = step === "intro" ? -1 : step === "scanning" ? 0 : step === "locating" ? 1 : step === "submitting" ? 2 : 3;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-md flex-col px-4 py-5 sm:py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-[1.05] font-bold tracking-[-0.02em]">Marcar ponto</h1>
          <p className="mt-1.5 flex items-center gap-2 text-[14px] text-muted">
            <span className="stem text-primary" aria-hidden />
            Próxima marcação: <span className="font-bold text-foreground">{action}</span>
          </p>
        </div>
        <Link href="/app/" className="inline-flex h-9 shrink-0 items-center rounded-md px-3 text-[13px] font-bold text-muted hover:bg-surface-2 hover:text-foreground">
          Voltar
        </Link>
      </div>

      <StemSteps labels={["QR Code", "Localização", "Validação"]} current={stepIdx === 3 ? 3 : Math.max(stepIdx, -1)} />

      <div key={step} className="flex flex-1 flex-col">
          {step === "intro" ? (
            <div className="mt-6 flex flex-1 flex-col">
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="px-5 pt-5 pb-5">
                  <p className="text-[20px] leading-tight font-bold tracking-[-0.02em]">Leia o QR Code da estação</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">
                    Aponte a câmara para o código no ecrã da recepção ou portaria. O código muda a cada poucos segundos.
                  </p>
                </div>
              </div>
              <ul className="mt-5 space-y-3.5 text-[13.5px] leading-relaxed text-muted">
                {[
                  "A localização é pedida apenas neste momento, para confirmar que está no local de trabalho. Não há rastreio contínuo.",
                  "A hora registada é a do servidor, não a do telemóvel.",
                  "Se o GPS estiver impreciso, a marcação fica em revisão e nunca é tratada como fraude.",
                ].map((t) => (
                  <li key={t} className="border-b border-border pb-3.5 last:border-0">
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-auto space-y-2 pt-6">
                <ManualCode open={manual} setOpen={setManual} code={code} setCode={setCode} error={codeError} onSubmit={applyCode} />
                <Button size="lg" className="w-full" onClick={() => setStep("scanning")}>
                  Abrir câmara
                </Button>
              </div>
            </div>
          ) : null}

          {step === "scanning" ? (
            <div className="mt-6 flex flex-1 flex-col">
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#0d0e16]">
                <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />
                <ScanFrame />
              </div>
              {camError ? (
                <Notice tone="warning" className="mt-4">
                  {camError}
                </Notice>
              ) : (
                <p className="mt-4 flex items-center justify-center gap-2 text-[14px] font-bold text-muted">
                  <span className="stem text-primary" aria-hidden />A procurar QR Code
                </p>
              )}
              <div className="mt-auto space-y-2 pt-6">
                <ManualCode open={manual} setOpen={setManual} code={code} setCode={setCode} error={codeError} onSubmit={applyCode} />
                <Button variant="outline" size="lg" className="w-full" onClick={() => setStep("intro")}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}

          {step === "locating" ? (
            <div className="mt-12 flex flex-1 flex-col items-center text-center">
              <StemLoader count={7} />
              <p className="mt-7 text-[20px] font-bold tracking-[-0.02em]">A obter localização</p>
              <p className="mt-1.5 text-[14px] text-muted">
                {liveAccuracy ? (
                  <>
                    Precisão actual <span className="font-bold text-foreground tabular">±{liveAccuracy} m</span>
                  </>
                ) : (
                  "Autorize o acesso à localização quando o navegador pedir."
                )}
              </p>
              {liveAccuracy ? (
                <div className="mt-4 w-full max-w-[220px]">
                  <ThickBar value={Math.max(8, 100 - liveAccuracy)} tone={liveAccuracy <= 20 ? "success" : "primary"} />
                </div>
              ) : null}
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
              <StemLoader count={5} />
              <p className="mt-7 text-[20px] font-bold tracking-[-0.02em]">A validar no servidor</p>
              <p className="mt-1.5 text-[14px] text-muted">QR Code, perímetro e dispositivo</p>
            </div>
          ) : null}

          {step === "result" && response ? (
            <Result response={response} timeZone={timeZone} fix={fix} note={note} setNote={setNote} onRetry={restart} onReview={requestReview} />
          ) : null}
      </div>
    </div>
  );
}

function ManualCode({
  open,
  setOpen,
  code,
  setCode,
  error,
  onSubmit,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  code: string;
  setCode: (v: string) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  if (!open) {
    return (
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        Introduzir código manualmente
      </Button>
    );
  }
  return (
    <form
      className="space-y-2.5 rounded-xl bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="qr-code" className="text-[13px] font-bold">
        Código da estação
      </label>
      <Input
        id="qr-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="ps1.…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
      />
      {error ? <p className="text-xs font-bold text-danger">{error}</p> : <p className="text-xs text-muted">Cole o código ou a ligação apresentada na estação.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Fechar
        </Button>
        <Button type="submit" disabled={!code.trim()}>
          Continuar
        </Button>
      </div>
    </form>
  );
}

/** Marca grande do resultado: hastes na cor do estado. */
function ResultMark({ tone }: { tone: "success" | "primary" | "warning" | "danger" }) {
  const color = { success: "text-success", primary: "text-primary", warning: "text-warning", danger: "text-danger" }[tone];
  return (
    <span className={cn("flex h-20 items-center gap-[7px]", color)} aria-hidden>
      {[30, 52, 76, 52, 30].map((h, i) => (
        <span key={i} className="block w-[9px] rounded-full bg-current" style={{ height: h, opacity: i === 2 ? 1 : 0.45 }} />
      ))}
    </span>
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
      <div className="mt-12 flex flex-1 flex-col items-center text-center">
        <ResultMark tone="danger" />
        <p className="mt-6 text-[24px] font-bold tracking-[-0.02em]">
          Marcação não registada
        </p>
        <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-muted">
          {response.error.message}
        </p>
        <Button size="lg" className="mt-auto h-14 w-full text-[16px] font-bold" onClick={onRetry}>
          Ler QR Code novamente
        </Button>
      </div>
    );
  }
  const r = response.result;
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(r.occurredAt));

  if (r.status === "rejected") {
    return (
      <div className="mt-8 flex flex-1 flex-col">
        <div className="flex flex-col items-center text-center">
          <ResultMark tone="warning" />
          <p className="mt-6 text-[24px] font-bold tracking-[-0.02em]">
            Fora do perímetro
          </p>
          <p className="mx-auto mt-2 max-w-xs text-[14px] leading-relaxed text-muted">
            {r.message}
          </p>
          {fix ? (
            <p className="mt-2 text-[13px] text-subtle">
              Precisão do GPS: <span className="font-bold tabular">±{Math.round(fix.accuracy)} m</span>
            </p>
          ) : null}
        </div>
        <div className="mt-7 space-y-2">
          <label htmlFor="note" className="text-[13px] font-bold">
            Está no local? Explique e peça revisão
          </label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: estou no armazém lateral, o sinal GPS é fraco." maxLength={300} />
        </div>
        <div className="mt-auto grid gap-2 pt-6">
          <Button size="lg" onClick={onRetry}>
            Tentar novamente
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
      <ResultMark tone={ok ? "success" : "primary"} />
      <p className="mt-6 text-[15px] font-bold text-muted">
        {TYPE_LABEL[r.type]}
      </p>
      <p className="text-[72px] leading-none font-bold tracking-[-0.02em] tabular">
        {time}
      </p>
      <div>
        <Badge tone={ok ? "success" : "primary"} className="mt-3 text-[14px]">
          {ok ? "Marcação validada" : "Em revisão"}
        </Badge>
      </div>
      <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted">
        {r.message}
      </p>
      <Button size="lg" className="mt-auto h-14 w-full text-[16px] font-bold" asChild>
        <Link href="/app/">Concluir</Link>
      </Button>
    </div>
  );
}
