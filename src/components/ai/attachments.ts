/**
 * Anexos para o assistente. Imagens e PDF seguem para o Gemini tal como estão (base64);
 * planilhas (Excel, CSV) e texto são convertidos em texto no navegador.
 */

export type Attachment = { name: string; mime: string; size: number; data?: string; text?: string };

export const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_FILES = 5;
const MAX_BINARY = 6 * 1024 * 1024; // por ficheiro (imagem ou PDF)
const MAX_TOTAL = 8 * 1024 * 1024; // soma dos anexos de uma mensagem (o pedido vai em base64)
const MAX_TEXT = 60_000; // caracteres por ficheiro de texto/planilha

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function base64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const cut = (t: string) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n[… ficheiro cortado: demasiado grande]` : t);

async function excelToText(buf: ArrayBuffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`# Folha: ${ws.name}`);
    let n = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (++n > 2000) return;
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object") {
          const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
          return String(o.text ?? o.result ?? o.richText?.map((r) => r.text).join("") ?? "");
        }
        return String(v);
      });
      out.push(cells.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";"));
    });
  });
  return out.join("\n");
}

/** Lê um ficheiro escolhido pelo utilizador. Lança um erro em português se não for suportado. */
export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name;
  const lower = name.toLowerCase();
  const mime = file.type || (lower.endsWith(".csv") ? "text/csv" : lower.endsWith(".txt") ? "text/plain" : lower.endsWith(".xlsx") ? XLSX : "");
  if (/\.(docx?|pptx?|xls)$/.test(lower)) throw new Error(`${name}: guarde como PDF (ou Excel .xlsx) e anexe outra vez.`);
  if (mime === XLSX || lower.endsWith(".xlsx")) return { name, mime: "text/plain", size: file.size, text: cut(await excelToText(await file.arrayBuffer())) };
  if (mime.startsWith("text/") || mime === "application/json") return { name, mime: "text/plain", size: file.size, text: cut(await file.text()) };
  if (/^image\/(png|jpeg|webp)$/.test(mime) || mime === "application/pdf") {
    if (file.size > MAX_BINARY) throw new Error(`${name}: o ficheiro tem mais de 6 MB.`);
    return { name, mime, size: file.size, data: base64(await file.arrayBuffer()) };
  }
  throw new Error(`${name}: tipo de ficheiro não suportado. Use imagem, PDF, Excel, CSV ou texto.`);
}

/** Junta ficheiros novos aos já escolhidos, respeitando os limites. */
export async function addAttachments(current: Attachment[], files: FileList | File[]): Promise<{ list: Attachment[]; errors: string[] }> {
  const list = [...current];
  const errors: string[] = [];
  for (const f of Array.from(files)) {
    if (list.length >= MAX_FILES) {
      errors.push(`Máximo de ${MAX_FILES} anexos por mensagem.`);
      break;
    }
    try {
      const a = await readAttachment(f);
      const total = list.reduce((s, x) => s + (x.data ? x.size : 0), 0) + (a.data ? a.size : 0);
      if (total > MAX_TOTAL) {
        errors.push(`${f.name}: os anexos juntos passam de 8 MB.`);
        continue;
      }
      list.push(a);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `${f.name}: não foi possível ler.`);
    }
  }
  return { list, errors };
}

export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
