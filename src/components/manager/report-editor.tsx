"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { buildReportDoc, renderReportDoc, type ReportDoc, type Vehicle } from "@/lib/domain/vehicle-pdf";
import { downloadBlob } from "@/lib/excel";
import { formatDateTime } from "@/lib/format";
import { canShareFiles, shareFile } from "@/lib/share";
import { errorMessage } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { filledPairs, type CustomField, type Extra } from "./custom-fields";
import { photoUrl } from "./photos";

const NOTE_KEY = "horbit-relatorio-observacoes";

/** Relatório da viatura: escolher o que entra, editar todo o texto e descarregar ou enviar o PDF. */
export function ReportEditor({ vehicle: v, vehicleFields, visitFields }: { vehicle: Vehicle; vehicleFields: CustomField[]; visitFields: CustomField[] }) {
  const { company, me, tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<"choose" | "edit">("choose");
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [opts, setOpts] = React.useState({ owner: true, materials: true, amounts: true, mileage: true, extras: true });
  const [doc, setDoc] = React.useState<ReportDoc | null>(null);
  const [withPhoto, setWithPhoto] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const cover = v.photos?.find((p) => p.id === v.coverId) ?? null;

  React.useEffect(() => {
    if (!open) return;
    setStep("choose");
    setChosen(v.visits.map((x) => x.id));
    setDoc(null);
  }, [open, v.visits]);

  const toEdit = () => {
    if (!chosen.length) return toast.error("Escolha pelo menos uma entrada.");
    const d = buildReportDoc(v, { visitIds: chosen, ...opts }, {
      company: company.companyName,
      currency: company.currency,
      tz,
      author: me.name,
      vehiclePairs: (e) => filledPairs(vehicleFields, e as Extra, company.currency),
      visitPairs: (e) => filledPairs(visitFields, e as Extra, company.currency),
    });
    try {
      d.note = localStorage.getItem(`${NOTE_KEY}:${company.companyId}`) ?? "";
    } catch {}
    setDoc(d);
    setStep("edit");
  };

  const make = async (mode: "download" | "share") => {
    if (!doc) return;
    setBusy(true);
    try {
      try {
        localStorage.setItem(`${NOTE_KEY}:${company.companyId}`, doc.note);
      } catch {}
      let photo: Uint8Array | null = null;
      if (withPhoto && cover) {
        const url = await photoUrl(cover.key);
        if (url) photo = new Uint8Array(await (await fetch(url)).arrayBuffer());
      }
      const bytes = await renderReportDoc(doc, photo);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const name = `relatorio-${v.plate.replace(/\W+/g, "")}.pdf`;
      if (mode === "share") {
        const r = await shareFile(blob, name, `${doc.title} ${v.plate}`);
        if (r !== "cancelled") toast.success(r === "shared" ? "Relatório enviado." : "Relatório descarregado.");
      } else {
        downloadBlob(blob, name);
        toast.success("Relatório descarregado.");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof ReportDoc>(k: K, val: ReportDoc[K]) => setDoc((d) => (d ? { ...d, [k]: val } : d));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Relatório PDF</Button>
      </DialogTrigger>
      <DialogContent
        title={step === "choose" ? "Relatório em PDF" : "Editar o relatório"}
        description={step === "choose" ? "Escolha as entradas e o que entra. No passo seguinte pode mudar todo o texto." : "Todo o texto pode ser mudado. Os dados da viatura não são alterados."}
        wide
      >
        {step === "choose" ? (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-bold">
                Entradas
                <span className="flex gap-3 text-[12.5px] font-bold">
                  <button type="button" className="text-primary" onClick={() => setChosen(v.visits.map((x) => x.id))}>Todas</button>
                  <button type="button" className="text-primary" onClick={() => setChosen(v.visits.slice(0, 1).map((x) => x.id))}>Só a última</button>
                </span>
              </legend>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {v.visits.map((x) => (
                  <li key={x.id}>
                    <label className="flex items-center gap-3 px-3 py-2 text-[13.5px]">
                      <Checkbox checked={chosen.includes(x.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, x.id] : c.filter((i) => i !== x.id)))} />
                      <span className="min-w-0 flex-1">
                        <b>{formatDateTime(x.enteredAt, tz)}</b>
                        <span className="block truncate text-[12.5px] text-muted">{x.services.join(", ") || x.description || "Sem trabalhos registados"}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-2 text-[13px] font-bold">Incluir</legend>
              {(
                [
                  ["owner", "Contacto do proprietário"],
                  ["materials", "Materiais usados"],
                  ["amounts", "Valores"],
                  ["mileage", "Quilómetros"],
                  ["extras", "Campos personalizados"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-[13.5px]">
                  <Checkbox checked={opts[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} /> {label}
                </label>
              ))}
              {cover ? (
                <label className="flex items-center gap-2 text-[13.5px]">
                  <Checkbox checked={withPhoto} onChange={(e) => setWithPhoto(e.target.checked)} /> Foto de perfil da viatura
                </label>
              ) : null}
            </fieldset>
            <Button className="w-full" onClick={toEdit}>Continuar para editar o texto</Button>
          </div>
        ) : doc ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Título"><Input value={doc.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Empresa"><Input value={doc.company} onChange={(e) => set("company", e.target.value)} /></Field>
              <Field label="Linha por baixo do nome" className="sm:col-span-2"><Input value={doc.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></Field>
              <Field label="Matrícula"><Input value={doc.plate} onChange={(e) => set("plate", e.target.value)} className="font-mono" /></Field>
              <Field label="Viatura"><Input value={doc.vehicleName} onChange={(e) => set("vehicleName", e.target.value)} /></Field>
            </div>

            <section>
              <p className="mb-2 text-[13px] font-bold">Dados</p>
              <ul className="space-y-2">
                {doc.info.map((it, i) => (
                  <li key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
                    <Input value={it.label} aria-label="Nome" onChange={(e) => set("info", doc.info.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input value={it.value} aria-label="Valor" onChange={(e) => set("info", doc.info.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    <Button type="button" variant="ghost" size="icon" aria-label="Retirar" onClick={() => set("info", doc.info.filter((_, j) => j !== i))}>
                      <Trash className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="soft" className="mt-2" onClick={() => set("info", [...doc.info, { label: "", value: "" }])}>
                <Plus className="size-4" aria-hidden /> Linha
              </Button>
            </section>

            {doc.sections.map((s, i) => {
              const upd = (k: keyof typeof s, val: string) => set("sections", doc.sections.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
              return (
                <section key={i} className="space-y-2 rounded-xl border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
                    <Input value={s.heading} aria-label="Título da entrada" onChange={(e) => upd("heading", e.target.value)} className="font-bold" />
                    <Input value={s.side} aria-label="Estado" onChange={(e) => upd("side", e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" aria-label="Retirar entrada" onClick={() => set("sections", doc.sections.filter((_, j) => j !== i))}>
                      <Trash className="size-4" />
                    </Button>
                  </div>
                  <Textarea value={s.body} aria-label="Texto da entrada" onChange={(e) => upd("body", e.target.value)} className="min-h-32" />
                  <Field label="Valor"><Input value={s.amount} onChange={(e) => upd("amount", e.target.value)} placeholder="Deixe vazio para não mostrar" /></Field>
                </section>
              );
            })}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Texto do total"><Input value={doc.totalLabel} onChange={(e) => set("totalLabel", e.target.value)} /></Field>
              <Field label="Total"><Input value={doc.total} onChange={(e) => set("total", e.target.value)} placeholder="Vazio = sem total" /></Field>
            </div>
            <Field label="Observações" hint="Fica guardado para o próximo relatório.">
              <Textarea value={doc.note} onChange={(e) => set("note", e.target.value)} placeholder="Ex.: Garantia de 3 meses na pintura." />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-[13.5px] sm:col-span-2">
                <Checkbox checked={doc.signatures} onChange={(e) => set("signatures", e.target.checked)} /> Linhas para assinatura
              </label>
              {doc.signatures ? (
                <>
                  <Input value={doc.sigLeft} aria-label="Assinatura à esquerda" onChange={(e) => set("sigLeft", e.target.value)} />
                  <Input value={doc.sigRight} aria-label="Assinatura à direita" onChange={(e) => set("sigRight", e.target.value)} />
                </>
              ) : null}
              <Field label="Rodapé" className="sm:col-span-2"><Input value={doc.footer} onChange={(e) => set("footer", e.target.value)} /></Field>
              <label className="flex items-start gap-2 text-[13.5px] sm:col-span-2">
                <Checkbox checked={doc.editable} onChange={(e) => set("editable", e.target.checked)} className="mt-0.5" />
                <span>
                  <b>PDF editável</b>
                  <span className="block text-[12.5px] text-muted">O texto das entradas e as observações continuam editáveis depois de descarregar (no leitor de PDF).</span>
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>Voltar</Button>
              <Button className="flex-1" onClick={() => void make("download")} disabled={busy}>
                {busy ? <span className="spinner" aria-hidden /> : null} Descarregar PDF
              </Button>
              {canShareFiles() ? (
                <Button variant="outline" className="flex-1" onClick={() => void make("share")} disabled={busy}>Enviar (WhatsApp, email…)</Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
