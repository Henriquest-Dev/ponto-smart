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
  createdAt: string;
  createdBy: string | null;
  visits: VehicleVisit[];
};

export type ReportOptions = {
  title: string;
  visitIds: string[];
  owner: boolean;
  materials: boolean;
  amounts: boolean;
  mileage: boolean;
  note: string;
};

const INK = rgb(0.09, 0.1, 0.16);
const MUTED = rgb(0.42, 0.44, 0.52);
const LINE = rgb(0.89, 0.9, 0.93);
const ACCENT = rgb(0.43, 0.24, 0.85);
const SOFT = rgb(0.97, 0.97, 0.99);

// Helvetica (WinAnsi) cobre os acentos do português; remove só o que estiver fora do conjunto.
const safe = (t: string) => t.replace(/[^\n -ÿ€]/g, "");

/** Parte um texto em linhas que cabem na largura. */
function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
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

/** Relatório da viatura em PDF (A4), com as entradas escolhidas. */
export async function renderVehicleReport(
  v: Vehicle,
  o: ReportOptions,
  ctx: { company: string; currency: string; tz: string; author: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${o.title} ${v.plate}`);
  pdf.setProducer("Horbit");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
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
  const ensure = (need: number) => {
    if (y - need > 60) return;
    page = pdf.addPage([W, H]);
    y = H - 52;
    text(`${v.plate} · ${v.name}`, L, 8.5, bold, MUTED);
    y -= 22;
  };
  const para = (value: string, x: number, width: number, size = 9.5, font = regular, color = INK, lh = 13) => {
    for (const line of wrap(value, font, size, width)) {
      ensure(lh);
      text(line, x, size, font, color);
      y -= lh;
    }
  };

  // Cabeçalho
  text(ctx.company, L, 14, bold);
  right(o.title.toUpperCase(), 10.5, bold, ACCENT);
  y -= 15;
  text(`Emitido a ${formatDateTime(new Date(), ctx.tz)} por ${ctx.author}`, L, 8.5, regular, MUTED);
  y -= 22;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: LINE });
  y -= 26;

  // Matrícula em destaque e dados da viatura
  const plate = safe(v.plate);
  const pw = bold.widthOfTextAtSize(plate, 18) + 28;
  page.drawRectangle({ x: L, y: y - 9, width: pw, height: 30, color: rgb(1, 0.85, 0.2), borderColor: INK, borderWidth: 1.2 });
  page.drawText(plate, { x: L + 14, y: y, size: 18, font: bold, color: INK });
  page.drawText(safe(v.name), { x: L + pw + 14, y: y + 2, size: 14, font: bold, color: INK });
  y -= 40;

  const info: [string, string][] = [
    ["Proprietário", v.ownerName],
    ...(o.owner && v.ownerPhone ? ([["Contacto", v.ownerPhone]] as [string, string][]) : []),
    ...(v.color ? ([["Cor", v.color]] as [string, string][]) : []),
    ["Primeira entrada", formatDateTime(v.createdAt, ctx.tz)],
    ["Entradas no relatório", String(o.visitIds.length)],
  ];
  info.forEach(([k, val], i) => {
    const col = i % 2 === 0 ? L : 310;
    if (i % 2 === 0 && i > 0) y -= 30;
    page.drawText(safe(k.toUpperCase()), { x: col, y, size: 7, font: regular, color: MUTED });
    page.drawText(safe(val).slice(0, 48), { x: col, y: y - 12, size: 10, font: bold, color: INK });
  });
  y -= 44;

  // Entradas na oficina
  const visits = v.visits.filter((x) => o.visitIds.includes(x.id)).sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
  let total = 0;
  visits.forEach((vis, idx) => {
    ensure(70);
    page.drawRectangle({ x: L, y: y - 7, width: R - L, height: 24, color: SOFT });
    text(`Entrada ${idx + 1} · ${formatDateTime(vis.enteredAt, ctx.tz)}`, L + 10, 10, bold);
    right(
      vis.status === "concluida" ? `Concluída${vis.finishedAt ? ` a ${formatDateTime(vis.finishedAt, ctx.tz)}` : ""}` : "Em curso",
      8.5,
      regular,
      vis.status === "concluida" ? MUTED : ACCENT,
    );
    y -= 28;
    const facts = [
      vis.services.length ? `Trabalhos: ${vis.services.join(", ")}` : null,
      o.mileage && vis.mileage ? `Quilómetros: ${vis.mileage.toLocaleString("pt-PT")} km` : null,
      vis.by ? `Responsável: ${vis.by}` : null,
    ].filter(Boolean) as string[];
    for (const f of facts) para(f, L + 10, R - L - 20, 9.5, regular, INK);
    if (vis.description) {
      y -= 3;
      para(vis.description, L + 10, R - L - 20, 9.5, regular, INK);
    }
    if (o.materials && vis.materials.length) {
      y -= 4;
      ensure(14);
      text("Materiais usados", L + 10, 8.5, bold, MUTED);
      y -= 13;
      for (const m of vis.materials) para(`- ${m.name}: ${Number(m.quantity).toLocaleString("pt-PT")} ${m.unit}`, L + 16, R - L - 30, 9, regular, INK, 12);
    }
    if (o.amounts && vis.amount) {
      total += Number(vis.amount);
      y -= 2;
      ensure(14);
      text("Valor", L + 10, 9.5, bold);
      right(formatMoney(vis.amount, ctx.currency), 9.5, bold, INK);
      y -= 13;
    }
    if (!facts.length && !vis.description && !(o.materials && vis.materials.length)) para("Sem trabalhos registados.", L + 10, R - L - 20, 9.5, regular, MUTED);
    y -= 14;
  });

  if (o.amounts && total > 0 && visits.length > 1) {
    ensure(30);
    page.drawLine({ start: { x: L, y: y + 6 }, end: { x: R, y: y + 6 }, thickness: 1, color: LINE });
    y -= 8;
    text("Total", L, 11, bold);
    right(formatMoney(total, ctx.currency), 11, bold, INK);
    y -= 22;
  }

  if (o.note.trim()) {
    ensure(40);
    text("Observações", L, 10, bold);
    y -= 15;
    para(o.note.trim(), L, R - L, 9.5);
    y -= 8;
  }

  // Assinaturas
  ensure(70);
  y -= 30;
  page.drawLine({ start: { x: L, y }, end: { x: L + 200, y }, thickness: 0.8, color: MUTED });
  page.drawLine({ start: { x: R - 200, y }, end: { x: R, y }, thickness: 0.8, color: MUTED });
  y -= 12;
  text("A oficina", L, 8.5, regular, MUTED);
  page.drawText("O cliente", { x: R - 200, y, size: 8.5, font: regular, color: MUTED });

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(safe(`Horbit · ${v.plate} · página ${i + 1} de ${pages.length}`), { x: L, y: 30, size: 7.5, font: regular, color: MUTED }),
  );
  return pdf.save();
}
