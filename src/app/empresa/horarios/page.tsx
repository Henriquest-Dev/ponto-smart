"use client";

import { CalendarClock, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { ErrorBlock, LoadingBlock, NoAccess } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/format";
import { attempt } from "@/lib/result";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const WD_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WD = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

type Rule = { weekday: number; startTime: string; endTime: string; breakMinutes: number };
type Schedule = { id: string; name: string; toleranceMinutes: number; rules: Rule[]; usage: number };
type Holiday = { id: string; date: string; name: string; recurring: boolean };

export default function SchedulesPage() {
  const { can } = useCompany();
  if (!can("schedules.manage")) return <NoAccess title="Horários e feriados" />;
  return <Schedules />;
}

function Schedules() {
  const { companyId, tz } = useCompany();
  const data = useData(async () => {
    const [s, h] = await Promise.all([
      sb()
        .from("work_schedules")
        .select("id,name,tolerance_minutes,schedule_rules(weekday,start_time,end_time,break_minutes)")
        .eq("company_id", companyId)
        .order("name"),
      sb().from("holidays").select("id,date,name,recurring").eq("company_id", companyId).order("date"),
    ]);
    const rows = must(s) as {
      id: string;
      name: string;
      tolerance_minutes: number;
      schedule_rules: { weekday: number; start_time: string; end_time: string; break_minutes: number }[];
    }[];
    const usage = new Map<string, number>();
    if (rows.length) {
      const a = must(await sb().from("shift_assignments").select("schedule_id").in("schedule_id", rows.map((r) => r.id)).limit(5000)) as { schedule_id: string }[];
      for (const x of a) usage.set(x.schedule_id, (usage.get(x.schedule_id) ?? 0) + 1);
    }
    const schedules: Schedule[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      toleranceMinutes: r.tolerance_minutes,
      usage: usage.get(r.id) ?? 0,
      rules: (r.schedule_rules ?? [])
        .map((x) => ({ weekday: x.weekday, startTime: x.start_time.slice(0, 5), endTime: x.end_time.slice(0, 5), breakMinutes: x.break_minutes }))
        .sort((x, y) => x.weekday - y.weekday),
    }));
    return { schedules, holidays: must(h) as Holiday[] };
  }, [companyId]);

  return (
    <>
      <PageHeader
        title="Horários e feriados"
        description="Escalas semanais, tolerâncias, intervalos e turnos nocturnos."
        actions={<ScheduleEditor onDone={data.reload} />}
      />
      <PageBody>
        <Notice tone="info">
          Um horário com fim anterior ao início (ex.: 22:00–06:00) é tratado como turno que atravessa a meia-noite: a saída conta para o dia da entrada.
        </Notice>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data && !data.error ? <LoadingBlock rows={3} /> : null}
        {data.data ? (
          <>
            {data.data.schedules.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Sem horários" description="Crie o primeiro horário e atribua-o aos colaboradores na respectiva ficha." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {data.data.schedules.map((s) => (
                  <Card key={s.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">{s.name}</p>
                        <p className="text-xs text-muted">
                          Tolerância {s.toleranceMinutes} min · {s.usage} {s.usage === 1 ? "atribuição" : "atribuições"}
                        </p>
                      </div>
                      <ScheduleEditor schedule={s} onDone={data.reload} />
                    </div>
                    <ul className="mt-4 grid grid-cols-7 gap-1 text-center">
                      {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                        const rule = s.rules.find((x) => x.weekday === wd);
                        return (
                          <li key={wd} className={`rounded-md px-0.5 py-2 ${rule ? "bg-primary-soft text-primary" : "bg-surface text-subtle"}`}>
                            <span className="block text-[11px] font-medium">{WD_SHORT[wd]}</span>
                            <span className="mt-1 block text-[10px] leading-tight tabular">{rule ? rule.startTime : "—"}</span>
                            <span className="block text-[10px] leading-tight tabular">{rule ? rule.endTime : ""}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {s.rules.some((x) => x.endTime <= x.startTime) ? (
                      <Badge tone="info" className="mt-3 self-start">Turno nocturno</Badge>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}

            <section>
              <SectionTitle
                title="Feriados"
                description="Feriados recorrentes repetem-se todos os anos. Confirme o calendário oficial anual."
                action={<HolidayForm onDone={data.reload} />}
              />
              {data.data.holidays.length === 0 ? (
                <EmptyState title="Sem feriados" description="Adicione os feriados nacionais e locais aplicáveis." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border">
                    {data.data.holidays.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="w-28 text-muted tabular">
                            {h.recurring
                              ? new Date(`${h.date}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "long", timeZone: "UTC" })
                              : formatDate(h.date, tz)}
                          </span>
                          <span className="font-medium">{h.name}</span>
                          {h.recurring ? <Badge>Anual</Badge> : null}
                        </span>
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          confirm={`Remover "${h.name}"?`}
                          action={() =>
                            attempt(async () => {
                              must(await sb().from("holidays").delete().eq("id", h.id));
                              data.reload();
                              return "Feriado removido.";
                            })
                          }
                        >
                          Remover
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </>
        ) : null}
      </PageBody>
    </>
  );
}

const TIME_RE = /^\d{2}:\d{2}$/;

function ScheduleEditor({ schedule, onDone }: { schedule?: Schedule; onDone: () => void }) {
  const { companyId, tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  const rule = (wd: number) => schedule?.rules.find((r) => r.weekday === wd);

  const save = (_p: unknown, fd: FormData) =>
    attempt(async () => {
      const name = String(fd.get("name") ?? "").trim();
      const tolerance = Number(fd.get("toleranceMinutes") ?? 10);
      if (name.length < 3) throw new Error("Indique o nome do horário.");
      if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 120) throw new Error("Tolerância entre 0 e 120 minutos.");
      const rules: Rule[] = [];
      for (let wd = 1; wd <= 7; wd++) {
        if (fd.get(`on_${wd}`) !== "on") continue;
        const startTime = String(fd.get(`start_${wd}`) ?? "").slice(0, 5);
        const endTime = String(fd.get(`end_${wd}`) ?? "").slice(0, 5);
        if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error(`Horas inválidas em ${WD[wd]}.`);
        if (startTime === endTime) throw new Error("Hora de início e fim não podem ser iguais.");
        const breakMinutes = Math.max(0, Math.min(240, Number(fd.get(`break_${wd}`) ?? 0) || 0));
        rules.push({ weekday: wd, startTime, endTime, breakMinutes });
      }
      if (!rules.length) throw new Error("Seleccione pelo menos um dia de trabalho.");

      let id = schedule?.id;
      if (id) {
        must(await sb().from("work_schedules").update({ name, tolerance_minutes: tolerance }).eq("id", id).select("id"));
        must(await sb().from("schedule_rules").delete().eq("schedule_id", id));
      } else {
        const row = must(
          await sb().from("work_schedules").insert({ company_id: companyId, name, tolerance_minutes: tolerance, timezone: tz }).select("id").single(),
        ) as { id: string };
        id = row.id;
      }
      must(
        await sb()
          .from("schedule_rules")
          .insert(rules.map((r) => ({ schedule_id: id, weekday: r.weekday, start_time: r.startTime, end_time: r.endTime, break_minutes: r.breakMinutes }))),
      );
      onDone();
      return "Horário guardado. Aplica-se aos dias ainda não fechados.";
    });

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
        <ActionForm action={save} onSuccess={() => setOpen(false)} resetOnSuccess={!schedule} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Nome"><Input name="name" required defaultValue={schedule?.name} /></Field>
            <Field label="Tolerância (min)">
              <Input name="toleranceMinutes" type="number" min={0} max={120} defaultValue={schedule?.toleranceMinutes ?? 10} />
            </Field>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Dia</th><th className="px-3 py-2">Início</th><th className="px-3 py-2">Fim</th><th className="px-3 py-2">Intervalo (min)</th>
                </tr>
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
                      <td className="px-3 py-2">
                        <Input type="number" name={`break_${wd}`} min={0} max={240} defaultValue={r?.breakMinutes ?? 60} className="h-9 w-24" />
                      </td>
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

function HolidayForm({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft"><Plus /> Feriado</Button>
      </DialogTrigger>
      <DialogContent title="Novo feriado">
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const date = String(fd.get("date") ?? "");
              const name = String(fd.get("name") ?? "").trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Indique a data.");
              if (name.length < 3) throw new Error("Indique o nome do feriado.");
              must(await sb().from("holidays").insert({ company_id: companyId, date, name, recurring: fd.get("recurring") === "on" }));
              onDone();
              return "Feriado adicionado.";
            })
          }
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <Field label="Data"><Input type="date" name="date" required /></Field>
          <Field label="Nome"><Input name="name" required placeholder="Ex.: Dia da cidade" /></Field>
          <label className="flex items-center gap-2.5 text-[13px]"><Checkbox name="recurring" defaultChecked /> Repete-se todos os anos</label>
          <SubmitButton className="w-full">Adicionar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
