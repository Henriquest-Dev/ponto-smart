"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { classifyDayAction, closeDayAction, reviewEventAction } from "./actions";

export function ClassifyDay({ dailyId, name, date, firstIn, lastOut }: { dailyId: string; name: string; date: string; firstIn: string; lastOut: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Corrigir</Button>
      </DialogTrigger>
      <DialogContent title="Corrigir registo" description={`${name} · ${date}. A versão anterior fica guardada no histórico.`}>
        <ActionForm action={classifyDayAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="dailyId" value={dailyId} />
          <Field label="Classificação">
            <Select name="status" defaultValue="unjustified">
              <option value="unjustified">Falta injustificada</option>
              <option value="justified">Falta justificada</option>
              <option value="on_time">Presença regularizada</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entrada (opcional)"><Input name="firstIn" type="time" defaultValue={firstIn} /></Field>
            <Field label="Saída (opcional)"><Input name="lastOut" type="time" defaultValue={lastOut} /></Field>
          </div>
          <Field label="Motivo" hint="Obrigatório — fica no trilho de auditoria.">
            <Textarea name="reason" required minLength={3} />
          </Field>
          <SubmitButton className="w-full">Guardar correcção</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function CloseDay({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Fechar dia</Button>
      </DialogTrigger>
      <DialogContent title="Fechar dia" description="Cria faltas pendentes para quem tinha horário e não marcou, e assinala registos sem saída. Pode ser repetido.">
        <ActionForm action={closeDayAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <Field label="Dia"><Input type="date" name="date" defaultValue={defaultDate} max={defaultDate} required /></Field>
          <SubmitButton className="w-full" pendingText="A processar…">Consolidar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewEvent({ eventId, name }: { eventId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">Rever</Button>
      </DialogTrigger>
      <DialogContent title="Rever marcação" description={`${name}. GPS inconclusivo não é prova de fraude: confirme com o supervisor ou testemunhas.`}>
        <ActionForm action={reviewEventAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="eventId" value={eventId} />
          <Field label="Decisão">
            <Select name="decision" defaultValue="accepted">
              <option value="accepted">Validar marcação</option>
              <option value="rejected">Rejeitar marcação</option>
            </Select>
          </Field>
          <Field label="Fundamento"><Textarea name="reason" required minLength={3} placeholder="Ex.: presença confirmada pelo supervisor no local." /></Field>
          <SubmitButton className="w-full">Confirmar decisão</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
