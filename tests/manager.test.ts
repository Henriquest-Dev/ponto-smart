import { describe, expect, it } from "vitest";
import { describeAudit } from "@/lib/audit-text";
import { buildReportDoc, renderReportDoc, renderVehicleReport, type Vehicle } from "@/lib/domain/vehicle-pdf";
import { hasModule } from "@/lib/manager-modules";

const vehicle: Vehicle = {
  id: "v",
  plate: "AAA 123 MC",
  name: "Nissan Hardbody",
  ownerName: "João Cossa",
  ownerPhone: "84 123 4567",
  color: null,
  notes: null,
  createdAt: "2026-10-16T08:00:00Z",
  createdBy: "Celso",
  visits: [
    {
      id: "a",
      enteredAt: "2026-10-16T08:00:00Z",
      finishedAt: null,
      status: "aberta",
      services: ["Pintura", "Pneus"],
      description: "Pintura da porta traseira. ".repeat(40),
      mileage: 85400,
      amount: 12500,
      by: "Celso",
      materials: [{ movementId: "m", itemId: "i", name: "Pneu 195/65 R15", unit: "un", quantity: 2 }],
    },
  ],
};

describe("painel do gerente", () => {
  it("funções avançadas: o gerente só as suas; o proprietário as da empresa; o colaborador nenhuma", () => {
    expect(hasModule({ role: "manager", modules: ["oficina"] }, "oficina")).toBe(true);
    expect(hasModule({ role: "manager", modules: [], companyModules: ["oficina"] }, "oficina")).toBe(false);
    expect(hasModule({ role: "owner", companyModules: ["oficina"] }, "oficina")).toBe(true);
    expect(hasModule({ role: "employee", modules: ["oficina"] }, "oficina")).toBe(false);
  });

  it("relatório da viatura gera um PDF (texto longo parte em linhas e páginas)", async () => {
    const bytes = await renderVehicleReport(
      vehicle,
      { title: "Relatório da viatura", visitIds: ["a"], owner: true, materials: true, amounts: true, mileage: true, extras: true, note: "Garantia de 3 meses." },
      { company: "Oficina Teste", currency: "MZN", tz: "Africa/Maputo", author: "Celso" },
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("relatório editado: o texto mudado vai para o PDF, que pode ter campos editáveis", async () => {
    const d = buildReportDoc(
      { ...vehicle, extra: { f1: "2019" } },
      { visitIds: ["a"], owner: true, materials: true, amounts: true, mileage: true, extras: true },
      { company: "Oficina", currency: "MZN", tz: "Africa/Maputo", author: "Celso", vehiclePairs: (e) => (e?.f1 ? [["Ano", String(e.f1)]] : []) },
    );
    expect(d.info.some((i) => i.label === "Ano" && i.value === "2019")).toBe(true);
    expect(d.sections[0].body).toContain("Pneu 195/65 R15: 2 un");
    d.title = "Orçamento";
    d.sections[0].body = "Texto escrito à mão.";
    d.editable = true;
    const bytes = await renderReportDoc(d);
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes);
    const fields = pdf.getForm().getFields();
    expect(fields.length).toBe(2);
    expect(pdf.getForm().getTextField("texto_1").getText()).toBe("Texto escrito à mão.");
  });

  it("auditoria em português", () => {
    expect(describeAudit({ action: "vehicle.create", entity: "vehicle", entity_id: "v", before: null, after: { plate: "AAA 123 MC", name: "Nissan" } })).toMatchObject({
      category: "Gestão",
      sentence: "registou a viatura AAA 123 MC (Nissan)",
    });
    expect(describeAudit({ action: "stock.item_create", entity: "stock_item", entity_id: "i", before: null, after: { name: "Verniz" } }).sentence).toBe(
      "adicionou ao estoque o material Verniz",
    );
  });
});
