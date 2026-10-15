import "server-only";
import ExcelJS from "exceljs";

export type Column = { header: string; key: string; width?: number; numFmt?: string };

/** Livro Excel com cabeçalho formatado, filtros e linha fixa. */
export async function buildWorkbook(sheets: { name: string; title: string; columns: Column[]; rows: Record<string, unknown>[] }[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PontoSmart";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.mergeCells(1, 1, 1, s.columns.length);
    ws.getCell(1, 1).value = s.title;
    ws.getCell(1, 1).font = { bold: true, size: 13 };
    ws.getRow(2).values = [];
    const header = ws.getRow(3);
    s.columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header;
      ws.getColumn(i + 1).width = c.width ?? 16;
      if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
    });
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7041EC" } };
    header.alignment = { vertical: "middle" };
    header.height = 22;
    for (const r of s.rows) ws.addRow(s.columns.map((c) => r[c.key] ?? null));
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: s.columns.length } };
    ws.views = [{ state: "frozen", ySplit: 3 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
