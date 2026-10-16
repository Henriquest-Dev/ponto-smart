import { HORBIT_PATH } from "@/components/shell/logo-path";

const VIOLET = "#673fec";
const INK = "#16131f";

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Cartão do QR Code fixo: QR com o símbolo Horbit ao centro e, por baixo, o logótipo Horbit,
 * o nome da empresa e o horário de validade. Devolve um SVG completo (600×800) pronto a mostrar,
 * imprimir ou converter em PNG. Correcção de erros alta (H) para o símbolo central não impedir a leitura.
 */
export async function brandedQrSvg({ url, company, subtitle }: { url: string; company: string; subtitle?: string }) {
  const QRCode = (await import("qrcode")).default;
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const size = 480; // área do QR
  const quiet = 2; // margem em módulos
  const cell = size / (n + quiet * 2);
  const x0 = 60;
  const y0 = 56;

  // Quadrado central reservado ao símbolo (cerca de 22% do lado).
  const hole = Math.ceil(n * 0.22) | 1;
  const hStart = Math.floor((n - hole) / 2);
  const inHole = (r: number, c: number) => r >= hStart && r < hStart + hole && c >= hStart && c < hStart + hole;

  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!data[r * n + c] || inHole(r, c)) continue;
      const x = x0 + (c + quiet) * cell;
      const y = y0 + (r + quiet) * cell;
      path += `M${x.toFixed(2)} ${y.toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }

  const holeSize = hole * cell;
  const hx = x0 + (hStart + quiet) * cell;
  const hy = y0 + (hStart + quiet) * cell;
  const pad = holeSize * 0.12;
  const mark = holeSize - pad * 2;
  const markScale = mark / 360;

  const wordH = 46;
  const wordScale = wordH / 376;
  const wordW = 1379 * wordScale;
  const textFont = `font-family="'M PLUS Rounded 1c', ui-rounded, system-ui, sans-serif"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <rect x="1" y="1" width="598" height="798" rx="36" fill="#ffffff" stroke="#e6e5ea" stroke-width="2"/>
  <path d="${path}" fill="${INK}"/>
  <rect x="${hx.toFixed(2)}" y="${hy.toFixed(2)}" width="${holeSize.toFixed(2)}" height="${holeSize.toFixed(2)}" rx="${(holeSize * 0.22).toFixed(2)}" fill="#ffffff"/>
  <rect x="${(hx + pad * 0.4).toFixed(2)}" y="${(hy + pad * 0.4).toFixed(2)}" width="${(holeSize - pad * 0.8).toFixed(2)}" height="${(holeSize - pad * 0.8).toFixed(2)}" rx="${(holeSize * 0.2).toFixed(2)}" fill="${VIOLET}"/>
  <g transform="translate(${(hx + pad).toFixed(2)} ${(hy + pad).toFixed(2)}) scale(${markScale.toFixed(4)})" fill="none" stroke="#ffffff" stroke-width="64" stroke-linecap="round">
    <path d="M70 48V312"/><path d="M262 48V128"/><path d="M70 196C130 150 165 175 198 214C228 250 262 262 300 252"/>
  </g>
  <g transform="translate(${((600 - wordW) / 2).toFixed(2)} 572) scale(${wordScale.toFixed(4)})"><path fill="${VIOLET}" fill-rule="evenodd" d="${HORBIT_PATH}"/></g>
  <text x="300" y="672" text-anchor="middle" ${textFont} font-size="34" font-weight="700" fill="${INK}">${esc(company)}</text>
  ${subtitle ? `<text x="300" y="718" text-anchor="middle" ${textFont} font-size="22" fill="#625f6e">${esc(subtitle)}</text>` : ""}
</svg>`;
}

/** Converte o SVG em PNG (para descarregar ou partilhar). */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Não foi possível gerar a imagem."));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 600 * scale;
  canvas.height = 800 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar PNG."))), "image/png"));
}
