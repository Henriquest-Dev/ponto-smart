"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { addHolidayAction, saveScheduleAction } from "./actions";

type Rule = { weekday: number; startTime: string; endTime: string; breakMinutes: number };
const WD = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export function ScheduleEditor({ schedule }: { schedule?: { id: string; name: string; toleranceMinutes: number; rules: Rule[] } }) {
  const [open, setOpen] = useState(false);
  const rule = (wd: number) => schedule?.rules.find((r) => r.weekday === wd);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {schedule ? (
          <Button size="icon-sm" variant="ghost" aria-label="Editar horário"><Pencil /></Button>
        ) : (
          <Button><Plus /> Novo horário</Button>
        )}
      </DialogTrigger>
      <DialogContent title={schedule ? "Editar horário" : "Novo horário"} wide>
        <ActionForm action={saveScheduleAction} onSuccess={() => setOpen(false)} resetOnSuccess={!schedule} className="space-y-4">
          {schedule ? <input type="hidden" name="id" value={schedule.id} /> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Nome"><Input name="name" required defaultValue={schedule?.name} /></Field>
            <Field label="Tolerância (min)"><Input name="toleranceMinutes" type="number" min={0} max={120} defaultValue={schedule?.toleranceMinutes ?? 10} /></Field>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr><th className="px-3 py-2">Dia</th><th className="px-3 py-2">Início</th><th className="px-3 py-2">Fim</th><th className="px-3 py-2">Intervalo (min)</th></tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                  const r = rule(wd);
                  const on = schedule ? !!r : wd <= 5;
                  return (
                    <tr key={wd} className="border-t border-border">
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2"><Checkbox name={`on_${wd}`} defaultChecked={on} /> {WD[wd]}</label>
                      </td>
                      <td className="px-3 py-2"><Input type="time" name={`start_${wd}`} defaultValue={r?.startTime ?? "08:00"} className="h-9" /></td>
                      <td className="px-3 py-2"><Input type="time" name={`end_${wd}`} defaultValue={r?.endTime ?? "17:00"} className="h-9" /></td>
                      <td className="px-3 py-2"><Input type="number" name={`break_${wd}`} min={0} max={240} defaultValue={r?.breakMinutes ?? 60} className="h-9 w-24" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <SubmitButton className="w-full">Guardar horário</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function HolidayForm() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft"><Plus /> Feriado</Button>
      </DialogTrigger>
      <DialogContent title="Novo feriado">
        <ActionForm action={addHolidayAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <Field label="Data"><Input type="date" name="date" required /></Field>
          <Field label="Nome"><Input name="name" required placeholder="Ex.: Dia da cidade" /></Field>
          <label className="flex items-center gap-2.5 text-[13px]"><Checkbox name="recurring" defaultChecked /> Repete-se todos os anos</label>
          <SubmitButton className="w-full">Adicionar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
