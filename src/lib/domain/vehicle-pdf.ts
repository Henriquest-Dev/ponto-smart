import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDateTime, formatMoney } from "@/lib/format";

export type VehicleVisit = {
  id: string;
  enteredAt: string;
  finishedAt: string | null;
  status: "aberta" | "concluida";
  services: string[];
  description: string | null;
  mileage: number | null;
  amount: number | null;
  by: string | null;
  extra?: Record<string, unknown>;
  materials: { movementId: string; itemId: string; name: string; unit: string; quantity: number }[];
};
export type Vehicle = {
  id: string;
  plate: string;
  name: string;
  ownerName: string;
  ownerPhone: string | null;
  color: string | null;
  notes: string | null;
  extra?: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
  coverId?: string | null;
  photos?: { id: string; key: string; thumb: string | null; at: string }[];
  visits: VehicleVisit[];
};

export type ReportOptions = {
  visitIds: string[];
  owner: boolean;
  materials: boolean;
  amounts: boolean;
  mileage: boolean;
  extras: boolean;
};

/** Documento do relatório: todo o texto pode ser editado antes de gerar o PDF. */
export type ReportDoc = {
  company: string;
  title: string;
  subtitle: string;
  plate: string;
  vehicleName: string;
  info: { label: string; value: string }[];
  sections: { heading: string; side: string; body: string; amount: string }[];
  totalLabel: string;
  total: string;
  note: string;
  signatures: boolean;
  sigLeft: string;
  sigRight: string;
  footer: string;
  /** Campos de texto que continuam editáveis no PDF descarregado (Adobe Reader, navegador, etc.). */
  editable: boolean;
};

type Pairs = (extra: Record<string, unknown> | undefined) => [string, string][];

/** Monta o texto inicial do relatório a partir dos dados da viatura. */
export function buildReportDoc(
  v: Vehicle,
  o: ReportOptions,
  ctx: { company: string; currency: string; tz: string; author: string; vehiclePairs?: Pairs; visitPairs?: Pairs },
): ReportDoc {
  const visits = v.visits.filter((x) => o.visitIds.includes(x.id)).sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
  let total = 0;
  const sections = visits.map((vis, i) => {
    const lines: string[] = [];
    if (vis.services.length) lines.push(`Trabalhos: ${vis.services.join(", ")}`);
    if (o.mileage && vis.mileage) lines.push(`Quilómetros: ${vis.mileage.toLocaleString("pt-PT")} km`);
    if (o.extras) for (const [k, val] of ctx.visitPairs?.(vis.extra) ?? []) lines.push(`${k}: ${val}`);
    if (vis.by) lines.push(`Responsável: ${vis.by}`);
    if (vis.description) lines.push("", vis.description);
    if (o.materials && vis.materials.length) {
      lines.push("", "Materiais usados:");
      for (const m of vis.materials) lines.push(`- ${m.name}: ${Number(m.quantity).toLocaleString("pt-PT")} ${m.unit}`);
    }
    if (!lines.length) lines.push("Sem trabalhos registados.");
    if (o.amounts && vis.amount) total += Number(vis.amount);
    return {
      heading: `Entrada ${i + 1} · ${formatDateTime(vis.enteredAt, ctx.tz)}`,
      side: vis.status === "concluida" ? `Concluída${vis.finishedAt ? ` a ${formatDateTime(vis.finishedAt, ctx.tz)}` : ""}` : "Em curso",
      body: lines.join("\n"),
      amount: o.amounts && vis.amount ? formatMoney(vis.amount, ctx.currency) : "",
    };
  });
  const info: { label: string; value: string }[] = [{ label: "Proprietário", value: v.ownerName }];
  if (o.owner && v.ownerPhone) info.push({ label: "Contacto", value: v.ownerPhone });
  if (v.color) info.push({ label: "Cor", value: v.color });
  if (o.extras) for (const [label, value] of ctx.vehiclePairs?.(v.extra) ?? []) info.push({ label, value });
  info.push({ label: "Primeira entrada", value: formatDateTime(v.createdAt, ctx.tz) });
  return {
    company: ctx.company,
    title: "Relatório da viatura",
    subtitle: `Emitido a ${formatDateTime(new Date(), ctx.tz)} por ${ctx.author}`,
    plate: v.plate,
    vehicleName: v.name,
    info,
    sections,
    totalLabel: "Total",
    total: o.amounts && total > 0 ? formatMoney(total, ctx.currency) : "",
    note: "",
    signatures: true,
    sigLeft: "A oficina",
    sigRight: "O cliente",
    footer: `${ctx.company} · ${v.plate}`,
    editable: false,
  };
}

const INK = rgb(0.09, 0.1, 0.16);
const MUTED = rgb(0.42, 0.44, 0.52);
const LINE = rgb(0.89, 0.9, 0.93);
const ACCENT = rgb(0.43, 0.24, 0.85);
const SOFT = rgb(0.97, 0.97, 0.99);

// Helvetica (WinAnsi) cobre os acentos do português; remove só o que estiver fora do conjunto.
const safe = (t: string) => t.replace(/[^\n -ÿ€]/g, "");

/** Parte um texto em linhas que cabem na largura. */
export function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(value).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** Gera o PDF (A4) a partir do documento editado. */
export async function renderReportDoc(d: ReportDoc, photo?: Uint8Array | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.title} ${d.plate}`);
  pdf.setProducer("Horbit");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = d.editable ? pdf.getForm() : null;
  let fieldN = 0;
  const W = 595.28;
  const H = 841.89;
  const L = 48;
  const R = W - 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - 52;

  const text = (value: string, x: number, size = 9.5, font = regular, color = INK) => page.drawText(safe(value), { x, y, size, font, color });
  const right = (value: string, size = 9, font = regular, color = MUTED) => {
    const s = safe(value);
    page.drawText(s, { x: R - font.widthOfTextAtSize(s, size), y, size, font, color });
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - 52;
    text(`${d.plate} · ${d.vehicleName}`, L, 8.5, bold, MUTED);
    y -= 22;
  };
  const ensure = (need: number) => {
    if (y - need < 60) newPage();
  };
  /** Bloco de texto: desenhado, ou como campo editável no PDF. */
  const block = (value: string, x: number, width: number, size = 9.5, lh = 13) => {
    const lines = wrap(value, regular, size, width);
    const height = lines.length * lh + 6;
    if (form && height < H - 140) {
      ensure(height);
      const f = form.createTextField(`texto_${++fieldN}`);
      f.enableMultiline();
      f.setText(safe(value));
      f.addToPage(page, { x: x - 2, y: y - height + lh, width: width + 4, height, borderWidth: 0, backgroundColor: rgb(1, 1, 1), font: regular });
      f.setFontSize(size);
      y -= height;
      return;
    }
    for (const line of lines) {
      ensure(lh);
      text(line, x, size);
      y -= lh;
    }
  };

  // Cabeçalho
  text(d.company, L, 14, bold);
  right(d.title.toUpperCase(), 10.5, bold, ACCENT);
  y -= 15;
  if (d.subtitle) text(d.subtitle, L, 8.5, regular, MUTED);
  y -= 22;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: LINE });
  y -= 26;

  // Foto de perfil à direita, matrícula e dados à esquerda
  let photoBottom = y;
  if (photo) {
    try {
      const img = await pdf.embedJpg(photo).catch(() => pdf.embedPng(photo));
      const maxW = 190;
      const maxH = 140;
      const s = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      page.drawImage(img, { x: R - w, y: y + 22 - h, width: w, height: h });
      photoBottom = y + 22 - h - 12;
    } catch {
      // foto ilegível: segue sem ela
    }
  }
  const leftW = photo ? R - L - 210 : R - L;
  const plate = safe(d.plate);
  const pw = bold.widthOfTextAtSize(plate, 18) + 28;
  page.drawRectangle({ x: L, y: y - 9, width: pw, height: 30, color: rgb(1, 0.85, 0.2), borderColor: INK, borderWidth: 1.2 });
  page.drawText(plate, { x: L + 14, y, size: 18, font: bold, color: INK });
  y -= 30;
  for (const line of wrap(d.vehicleName, bold, 13, leftW)) {
    text(line, L, 13, bold);
    y -= 16;
  }
  y -= 10;
  const colW = photo ? leftW : (R - L) / 2 - 10;
  d.info
    .filter((i) => i.label.trim() || i.value.trim())
    .forEach((it, i) => {
      const twoCols = !photo;
      const col = twoCols && i % 2 === 1 ? L + (R - L) / 2 : L;
      if (twoCols && i % 2 === 1) y += 30;
      ensure(30);
      text(it.label.toUpperCase(), col, 7, regular, MUTED);
      y -= 12;
      text(wrap(it.value, bold, 10, colW)[0] ?? "", col, 10, bold);
      y -= 18;
    });
  y = Math.min(y, photoBottom) - 10;

  // Entradas
  for (const s of d.sections) {
    ensure(70);
    page.drawRectangle({ x: L, y: y - 7, width: R - L, height: 24, color: SOFT });
    text(s.heading, L + 10, 10, bold);
    if (s.side) right(s.side, 8.5, regular, /curso/i.test(s.side) ? ACCENT : MUTED);
    y -= 28;
    block(s.body, L + 10, R - L - 20);
    if (s.amount.trim()) {
      y -= 2;
      ensure(14);
      text("Valor", L + 10, 9.5, bold);
      right(s.amount, 9.5, bold, INK);
      y -= 13;
    }
    y -= 14;
  }

  if (d.total.trim()) {
    ensure(30);
    page.drawLine({ start: { x: L, y: y + 6 }, end: { x: R, y: y + 6 }, thickness: 1, color: LINE });
    y -= 8;
    text(d.totalLabel || "Total", L, 11, bold);
    right(d.total, 11, bold, INK);
    y -= 22;
  }

  if (d.note.trim() || form) {
    ensure(40);
    text("Observações", L, 10, bold);
    y -= 15;
    block(d.note.trim() || " ", L, R - L);
    y -= 8;
  }

  if (d.signatures) {
    ensure(70);
    y -= 30;
    page.drawLine({ start: { x: L, y }, end: { x: L + 200, y }, thickness: 0.8, color: MUTED });
    page.drawLine({ start: { x: R - 200, y }, end: { x: R, y }, thickness: 0.8, color: MUTED });
    y -= 12;
    text(d.sigLeft, L, 8.5, regular, MUTED);
    page.drawText(safe(d.sigRight), { x: R - 200, y, size: 8.5, font: regular, color: MUTED });
  }

  form?.updateFieldAppearances(regular);
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(safe(`${d.footer} · página ${i + 1} de ${pages.length}`), { x: L, y: 30, size: 7.5, font: regular, color: MUTED }),
  );
  return pdf.save();
}

/** Atalho: relatório com o texto automático (sem edição). */
export async function renderVehicleReport(
  v: Vehicle,
  o: ReportOptions & { title?: string; note?: string },
  ctx: { company: string; currency: string; tz: string; author: string },
): Promise<Uint8Array> {
  const d = buildReportDoc(v, o, ctx);
  if (o.title) d.title = o.title;
  if (o.note) d.note = o.note;
  return renderReportDoc(d);
}
