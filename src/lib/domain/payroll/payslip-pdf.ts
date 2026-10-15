import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney, periodLabel } from "@/lib/format";

export type PayslipData = {
  reference: string;
  company: { name: string; nuit: string | null; address: string | null };
  employee: { name: string; code: string; jobTitle: string | null; nuit: string | null; department: string | null };
  period: { year: number; month: number };
  run: { version: number; engineVersion: string; inputHash: string; approvedAt: Date | null };
  currency: string;
  lines: { code: string; description: string; nature: "earning" | "deduction"; quantity: string | null; amount: string }[];
  gross: string;
  deductions: string;
  net: string;
  issuedAt: Date;
};

const INK = rgb(0.09, 0.1, 0.16);
const MUTED = rgb(0.42, 0.44, 0.52);
const LINE = rgb(0.89, 0.9, 0.93);
const ACCENT = rgb(0.43, 0.24, 0.85);

// Helvetica (WinAnsi) cobre os acentos do português; remove apenas caracteres fora do conjunto.
const safe = (t: string) => t.replace(/[^ -ÿ€]/g, "");

function text(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size = 9, color = INK) {
  page.drawText(safe(value), { x, y, size, font, color });
}
function right(page: PDFPage, value: string, xRight: number, y: number, font: PDFFont, size = 9, color = INK) {
  const v = safe(value);
  page.drawText(v, { x: xRight - font.widthOfTextAtSize(v, size), y, size, font, color });
}

export async function renderPayslipPdf(d: PayslipData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Recibo ${d.reference}`);
  pdf.setProducer("PontoSmart");
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const L = 48;
  const R = 547;
  let y = 790;

  text(page, d.company.name, L, y, bold, 14);
  right(page, "RECIBO DE VENCIMENTO", R, y, bold, 11, ACCENT);
  y -= 16;
  text(page, [d.company.nuit ? `NUIT ${d.company.nuit}` : null, d.company.address].filter(Boolean).join(" · "), L, y, regular, 8.5, MUTED);
  right(page, `Ref. ${d.reference}`, R, y, regular, 8.5, MUTED);
  y -= 26;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: LINE });
  y -= 22;

  const info: [string, string][] = [
    ["Colaborador", d.employee.name],
    ["Nº mecanográfico", d.employee.code],
    ["Função", d.employee.jobTitle ?? "—"],
    ["Departamento", d.employee.department ?? "—"],
    ["NUIT", d.employee.nuit ?? "—"],
    ["Período", periodLabel(d.period.year, d.period.month)],
  ];
  info.forEach(([k, v], i) => {
    const col = i % 2 === 0 ? L : 310;
    if (i % 2 === 0 && i > 0) y -= 30;
    text(page, k.toUpperCase(), col, y, regular, 7, MUTED);
    text(page, v, col, y - 12, bold, 10);
  });
  y -= 44;

  page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 22, color: rgb(0.97, 0.97, 0.99) });
  text(page, "Código", L + 8, y, bold, 8, MUTED);
  text(page, "Descrição", L + 90, y, bold, 8, MUTED);
  right(page, "Qtd.", 360, y, bold, 8, MUTED);
  right(page, "Abonos", 450, y, bold, 8, MUTED);
  right(page, "Descontos", R - 8, y, bold, 8, MUTED);
  y -= 24;

  for (const l of d.lines) {
    text(page, l.code, L + 8, y, regular, 8.5, MUTED);
    text(page, l.description.slice(0, 48), L + 90, y, regular, 9);
    right(page, l.quantity ? Number(l.quantity).toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : "", 360, y, regular, 9, MUTED);
    const amount = formatMoney(l.amount, d.currency);
    if (l.nature === "earning") right(page, amount, 450, y, regular, 9);
    else right(page, amount, R - 8, y, regular, 9);
    y -= 8;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: LINE });
    y -= 14;
  }

  y -= 8;
  const totals: [string, string, boolean][] = [
    ["Total ilíquido", d.gross, false],
    ["Total de descontos", d.deductions, false],
    ["Líquido a receber", d.net, true],
  ];
  for (const [k, v, strong] of totals) {
    text(page, k, 330, y, strong ? bold : regular, strong ? 11 : 9.5, strong ? INK : MUTED);
    right(page, formatMoney(v, d.currency), R - 8, y, strong ? bold : regular, strong ? 12 : 9.5, strong ? ACCENT : INK);
    y -= strong ? 22 : 16;
  }

  const foot = 96;
  page.drawLine({ start: { x: L, y: foot + 30 }, end: { x: R, y: foot + 30 }, thickness: 0.5, color: LINE });
  text(page, "Este recibo não constitui comprovativo de pagamento bancário. A confirmação de recepção pelo colaborador", L, foot + 14, regular, 7.5, MUTED);
  text(page, "não equivale a confirmação de pagamento.", L, foot + 4, regular, 7.5, MUTED);
  text(
    page,
    `Processamento v${d.run.version} · ${d.run.engineVersion} · integridade ${d.run.inputHash.slice(0, 16)}`,
    L, foot - 12, regular, 7, MUTED,
  );
  text(page, `Emitido em ${d.issuedAt.toISOString().slice(0, 10)} · Gerado por PontoSmart`, L, foot - 24, regular, 7, MUTED);

  return pdf.save();
}
