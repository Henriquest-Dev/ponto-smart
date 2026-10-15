"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ABSENCE_TYPES } from "@/components/collab/shared";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { attempt, formObject } from "@/lib/result";
import { errorMessage, rpc, sb } from "@/lib/sb/client";

const BUCKET = "justificacoes";
const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Nome de ficheiro seguro para o caminho no Storage. */
function safeName(name: string) {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  return (clean || "anexo").slice(-80);
}

function checkFiles(list: File[]): string | null {
  if (list.length > MAX_FILES) return `No máximo ${MAX_FILES} anexos por pedido.`;
  if (list.some((f) => !MIME.includes(f.type))) return "Use apenas PDF ou imagem (JPEG, PNG ou WEBP).";
  if (list.some((f) => f.size > MAX_BYTES)) return "Cada ficheiro pode ter no máximo 5 MB.";
  return null;
}

export function NewAbsence({ companyId, suggestions, onDone }: { companyId: string; suggestions: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const first = suggestions[suggestions.length - 1] ?? "";

  const submit = (_prev: unknown, fd: FormData) =>
    attempt(async () => {
      const v = formObject(fd);
      if (!v.startDate || !v.endDate) throw new Error("Indique as datas.");
      if (!v.type) throw new Error("Escolha o tipo.");
      if (!v.reason || v.reason.length < 5) throw new Error("Descreva o motivo (mín. 5 caracteres).");
      const list = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      const bad = checkFiles(list);
      if (bad) throw new Error(bad);

      const requestId = await rpc<string>("ps_submit_absence", {
        p_company: companyId,
        p_start: v.startDate,
        p_end: v.endDate,
        p_type: v.type,
        p_reason: v.reason,
      });

      const failed: string[] = [];
      for (const file of list) {
        try {
          const path = `${companyId}/${requestId}/${crypto.randomUUID()}-${safeName(file.name)}`;
          const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
          if (up.error) throw up.error;
          await rpc("ps_attach_absence_document", {
            p_request: requestId,
            p_path: path,
            p_name: file.name.slice(0, 120),
            p_mime: file.type,
            p_size: file.size,
          });
        } catch (err) {
          console.error(err);
          failed.push(file.name);
        }
      }
      if (failed.length) {
        toast.warning(`Pedido submetido, mas não foi possível anexar: ${failed.join(", ")}.`);
        return { ok: true };
      }
      return "Justificação submetida. Será notificado da decisão.";
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nova justificação</Button>
      </DialogTrigger>
      <DialogContent title="Nova justificação" description="O pedido segue para o supervisor e/ou RH. Anexe documento comprovativo se existir.">
        <ActionForm
          action={submit}
          onSuccess={() => {
            setOpen(false);
            setFiles([]);
            onDone();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" htmlFor="startDate">
              <Input id="startDate" name="startDate" type="date" required defaultValue={first} />
            </Field>
            <Field label="Até" htmlFor="endDate">
              <Input id="endDate" name="endDate" type="date" required defaultValue={first} />
            </Field>
          </div>
          <Field label="Tipo" htmlFor="type">
            <Select id="type" name="type" required defaultValue="">
              <option value="" disabled>
                Escolha…
              </option>
              {Object.entries(ABSENCE_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motivo" htmlFor="reason">
            <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} placeholder="Descreva brevemente a situação." />
          </Field>
          <Field label="Anexos (opcional)" hint="PDF ou imagem (JPEG, PNG, WEBP); até 5 MB cada (máx. 3).">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-border-strong px-4 py-3.5 text-[13.5px] font-bold text-muted transition-colors hover:border-primary hover:text-foreground">
              <span className="stem text-primary" aria-hidden />
              <span className="truncate">{files.length ? files.join(", ") : "Escolher ficheiros ou tirar fotografia"}</span>
              <input
                type="file"
                name="files"
                multiple
                accept={MIME.join(",")}
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  const bad = checkFiles(list);
                  if (bad) {
                    toast.error(bad);
                    e.target.value = "";
                    setFiles([]);
                    return;
                  }
                  setFiles(list.map((f) => f.name));
                }}
              />
            </label>
          </Field>
          <SubmitButton className="w-full" size="lg" pendingText="A enviar…">
            Submeter justificação
          </SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function CancelAbsence({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <ActionButton
      variant="ghost"
      size="sm"
      confirm="Cancelar este pedido?"
      action={() =>
        attempt(async () => {
          await rpc("ps_cancel_absence", { p_request: id });
          onDone();
          return "Pedido cancelado.";
        })
      }
    >
      Cancelar pedido
    </ActionButton>
  );
}

/** Abre um anexo privado através de uma ligação temporária (2 minutos). */
export function DocumentLink({ path, name }: { path: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        // Abrir a janela já no clique evita o bloqueio de pop-ups em telemóveis.
        const win = window.open("", "_blank");
        start(async () => {
          const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 120);
          if (error || !data?.signedUrl) {
            win?.close();
            toast.error(error ? errorMessage(error) : "Não foi possível abrir o anexo.");
            return;
          }
          if (win) win.location.href = data.signedUrl;
          else window.location.href = data.signedUrl;
        });
      }}
      className="inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-background px-4 text-[13px] font-bold transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {pending ? <span className="spinner" /> : <span className="stem text-primary" aria-hidden />}
      <span className="truncate">{name}</span>
    </button>
  );
}
