"use client";

import { Plus, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cancelAbsenceAction, createAbsenceAction } from "../actions";

const TYPES: [string, string][] = [
  ["doenca", "Doença"],
  ["consulta", "Consulta médica"],
  ["falecimento", "Falecimento de familiar"],
  ["casamento", "Casamento"],
  ["parentalidade", "Parentalidade"],
  ["formacao", "Formação / exames"],
  ["servico", "Serviço externo"],
  ["outro", "Outro motivo"],
];

export function NewAbsence({ suggestions }: { suggestions: string[] }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const first = suggestions[suggestions.length - 1] ?? "";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nova justificação
        </Button>
      </DialogTrigger>
      <DialogContent title="Nova justificação" description="O pedido segue para o supervisor e/ou RH. Anexe documento comprovativo se existir.">
        <ActionForm action={createAbsenceAction} onSuccess={() => { setOpen(false); setFiles([]); }} className="space-y-4">
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
              <option value="" disabled>Escolha…</option>
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Motivo" htmlFor="reason">
            <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} placeholder="Descreva brevemente a situação." />
          </Field>
          <Field label="Anexos (opcional)" hint="PDF ou imagem; até 4 MB cada e 5 MB no total (máx. 3).">
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border-strong px-3 py-3 text-[13px] text-muted hover:bg-surface">
              <Upload className="size-4" />
              <span className="truncate">{files.length ? files.join(", ") : "Escolher ficheiros ou tirar fotografia"}</span>
              <input
                type="file"
                name="files"
                multiple
                accept="application/pdf,image/*"
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.reduce((s, f) => s + f.size, 0) > 5 * 1024 * 1024 || list.some((f) => f.size > 4 * 1024 * 1024)) {
                    toast.error("Ficheiros demasiado grandes: até 4 MB cada e 5 MB no total.");
                    e.target.value = "";
                    setFiles([]);
                    return;
                  }
                  setFiles(list.map((f) => f.name));
                }}
              />
            </label>
          </Field>
          <SubmitButton className="w-full" size="lg" pendingText="A enviar…">Submeter justificação</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function CancelAbsence({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Cancelar este pedido?")) return;
        start(async () => {
          const r = await cancelAbsenceAction(id);
          if (r.ok) toast.success(r.message ?? "Cancelado.");
          else toast.error(r.error);
        });
      }}
    >
      Cancelar pedido
    </Button>
  );
}
