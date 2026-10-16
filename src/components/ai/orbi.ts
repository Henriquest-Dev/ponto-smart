/**
 * Orbi — mascote-olho do assistente (segundo o "Orbi — Guia de Implementação").
 * Desenha num <canvas>: a íris segue o cursor e o dedo, olha para o texto que se escreve,
 * revira a pensar, olha à volta quando ninguém mexe e pisca. Sem dependências.
 * Diferença em relação ao guia: devolve destroy() para remover os eventos ao sair da página (React).
 */

export type OrbiColors = { brand: string; deep: string; pupil: string; shade: [number, number, number] };
export type OrbiApi = {
  /** true enquanto a IA prepara a resposta. */
  setThinking: (v: boolean) => void;
  /** Olhar para um elemento (até o cursor mexer). */
  lookAt: (el: Element | null) => void;
  /** Seguir o fim do texto de uma caixa de mensagem. */
  follow: (input: HTMLInputElement | HTMLTextAreaElement | null) => void;
  blink: () => void;
  destroy: () => void;
};

const DEFAULTS: OrbiColors = { brand: "#663fec", deep: "#2c1678", pupil: "#100830", shade: [150, 120, 230] };

export function Orbi(cv: HTMLCanvasElement, opts: Partial<OrbiColors> = {}): OrbiApi {
  const C = { ...DEFAULTS, ...opts };
  const ctx = cv.getContext("2d")!;
  const W = cv.width,
    H = cv.height,
    cx = W / 2,
    cy = H / 2;
  const R_EYE = Math.min(W, H) * 0.44,
    R_IRIS = R_EYE * 0.56,
    R_PUP = R_EYE * 0.29,
    MOVE = R_EYE * 0.4;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Globo ocular com sombra granulada (desenhado uma vez).
  const ball = document.createElement("canvas"),
    BS = Math.ceil(R_EYE * 2 + 4);
  ball.width = ball.height = BS;
  const bctx = ball.getContext("2d")!,
    img = bctx.createImageData(BS, BS),
    d = img.data,
    c0 = BS / 2;
  for (let y = 0; y < BS; y++)
    for (let x = 0; x < BS; x++) {
      const r = Math.hypot(x + 0.5 - c0, y + 0.5 - c0);
      if (r > R_EYE + 1) continue;
      const a = Math.max(0, Math.min(1, R_EYE - r + 0.5));
      const dd = Math.hypot(x - (c0 - R_EYE * 0.18), y - (c0 - R_EYE * 0.24)) / (R_EYE * 1.25);
      const sh = Math.max(0, Math.min(1, (dd - 0.55) / 0.5)),
        st = Math.random() < Math.pow(sh, 1.3) ? 0.85 : 0;
      const i = (y * BS + x) * 4;
      d[i] = 255 + (C.shade[0] - 255) * st;
      d[i + 1] = 255 + (C.shade[1] - 255) * st;
      d[i + 2] = 255 + (C.shade[2] - 255) * st;
      d[i + 3] = a * 255;
    }
  bctx.putImageData(img, 0, 0);

  let target: { x: number; y: number } | null = null,
    lastMove = -1e9,
    thinking = false,
    lookEl: Element | null = null,
    focusEl: HTMLInputElement | HTMLTextAreaElement | null = null;
  let blinkT = -1,
    nextBlink = 2,
    squash = 0,
    raf = 0,
    alive = true;
  const eye = { lx: 0, ly: 0, vx: 0, vy: 0 };

  const toLocal = (px: number, py: number) => {
    const r = cv.getBoundingClientRect();
    return { x: ((px - r.left) / (r.width || 1)) * W, y: ((py - r.top) / (r.height || 1)) * H };
  };
  const point = (px: number, py: number) => {
    target = toLocal(px, py);
    lastMove = performance.now() / 1000;
    lookEl = null;
  };

  // Rato, caneta e dedo (alguns telemóveis não enviam pointermove durante o scroll).
  const onPointer = (e: PointerEvent) => point(e.clientX, e.clientY);
  const onTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) point(t.clientX, t.clientY);
  };
  const onTap = () => {
    squash = 1;
    api.blink();
  };
  const passive = { passive: true } as const;
  addEventListener("pointermove", onPointer, passive);
  addEventListener("pointerdown", onPointer, passive);
  addEventListener("touchstart", onTouch, passive);
  addEventListener("touchmove", onTouch, passive);
  cv.addEventListener("pointerdown", onTap);

  function lookGoal(t: number) {
    if (thinking) return { x: Math.cos(t * 4) * 0.8, y: Math.sin(t * 4) * 0.6 }; // olho a "pensar"
    let p: { x: number; y: number } | null = null;
    if (lookEl) {
      const r = lookEl.getBoundingClientRect();
      p = toLocal(r.left + r.width / 2, r.top + r.height / 2);
    } else if (focusEl) {
      const f = focusEl.getBoundingClientRect();
      p = toLocal(f.left + Math.min(f.width - 20, 18 + focusEl.value.length * 8), f.top + f.height / 2);
    } else if (target && t - lastMove < 3) p = target;
    if (p) {
      const dx = p.x - cx,
        dy = p.y - cy,
        dist = Math.hypot(dx, dy) || 1;
      const amt = Math.min(1, dist / (R_EYE * 1.2));
      return { x: (dx / dist) * amt, y: (dy / dist) * amt };
    }
    // Parado: olha à volta devagar.
    const k = Math.floor(t / 1.4),
      ang = (((k * 137) % 360) * Math.PI) / 180;
    return { x: Math.cos(ang) * 0.7, y: Math.sin(ang) * 0.55 };
  }

  let last = performance.now() / 1000;
  function frame() {
    if (!alive) return;
    const t = performance.now() / 1000,
      dt = Math.min(0.05, t - last);
    last = t;
    const g = lookGoal(t);
    // Mola com um pequeno exagero (overshoot).
    eye.vx += (g.x - eye.lx) * 260 * dt;
    eye.vy += (g.y - eye.ly) * 260 * dt;
    const damp = Math.pow(0.0009, dt);
    eye.vx *= damp;
    eye.vy *= damp;
    eye.lx += eye.vx * dt;
    eye.ly += eye.vy * dt;

    if (!reduce && t > nextBlink && blinkT < 0) {
      blinkT = t;
      nextBlink = t + 3 + Math.random() * 3.5;
    }
    let b = 0;
    if (blinkT >= 0) {
      const u = (t - blinkT) / 0.22;
      if (u > 1) blinkT = -1;
      else b = Math.sin(u * Math.PI);
    }
    squash = Math.max(0, squash - dt * 4);
    draw(t, b, eye.lx, eye.ly);
    raf = requestAnimationFrame(frame);
  }

  function draw(t: number, b: number, lx: number, ly: number) {
    ctx.clearRect(0, 0, W, H);
    const bob = reduce ? 0 : Math.sin(t * 2.1) * R_EYE * 0.02,
      sq = Math.sin(squash * Math.PI) * 0.08;
    const ex = cx + lx * R_EYE * 0.05,
      ey = cy + ly * R_EYE * 0.05 + bob;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(1 + sq, 1 - sq);
    ctx.translate(-ex, -ey);
    ctx.drawImage(ball, ex - BS / 2, ey - BS / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, ey, R_EYE, 0, 7);
    ctx.clip();
    // Íris
    const ix = ex + lx * MOVE,
      iy = ey + ly * MOVE;
    ctx.fillStyle = C.brand;
    ctx.beginPath();
    ctx.arc(ix, iy, R_IRIS, 0, 7);
    ctx.fill();
    ctx.strokeStyle = C.deep;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = R_EYE * 0.03;
    ctx.beginPath();
    ctx.arc(ix, iy, R_IRIS * 0.97, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Pupila e brilhos
    const px = ix + lx * R_EYE * 0.11,
      py = iy + ly * R_EYE * 0.11;
    const rp = R_PUP * (1 + 0.06 * Math.sin(t * 5) + (thinking ? 0.12 : 0));
    ctx.fillStyle = C.pupil;
    ctx.beginPath();
    ctx.arc(px, py, rp, 0, 7);
    ctx.fill();
    star(px - rp * 0.55, py - rp * 0.55, R_EYE * 0.11);
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(px + rp * 0.35, py + rp * 0.45, R_EYE * 0.03, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Pálpebra (piscar)
    if (b > 0) {
      const lyy = ey - R_EYE + b * 2 * R_EYE * 1.02,
        cv2 = R_EYE * 0.18 * (1 - b * 0.5);
      ctx.fillStyle = C.brand;
      ctx.beginPath();
      ctx.moveTo(ex - R_EYE - 2, ey - R_EYE - 2);
      ctx.lineTo(ex + R_EYE + 2, ey - R_EYE - 2);
      ctx.lineTo(ex + R_EYE + 2, lyy);
      ctx.quadraticCurveTo(ex, lyy + cv2 * 2, ex - R_EYE - 2, lyy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = C.deep;
      ctx.lineWidth = R_EYE * 0.025;
      ctx.beginPath();
      ctx.moveTo(ex + R_EYE + 2, lyy);
      ctx.quadraticCurveTo(ex, lyy + cv2 * 2, ex - R_EYE - 2, lyy);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  function star(x: number, y: number, r: number) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        rr = i % 2 ? r * 0.38 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  const api: OrbiApi = {
    setThinking: (v) => {
      thinking = !!v;
    },
    lookAt: (el) => {
      lookEl = el || null;
    },
    follow: (input) => {
      focusEl = input || null;
    },
    blink: () => {
      blinkT = performance.now() / 1000;
    },
    destroy: () => {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onPointer);
      removeEventListener("pointerdown", onPointer);
      removeEventListener("touchstart", onTouch);
      removeEventListener("touchmove", onTouch);
      cv.removeEventListener("pointerdown", onTap);
    },
  };
  raf = requestAnimationFrame(frame);
  return api;
}
