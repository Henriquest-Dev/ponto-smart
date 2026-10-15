import { asc, count, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { holidays, scheduleRules, shiftAssignments, workSchedules } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { removeHolidayAction } from "./actions";
import { HolidayForm, ScheduleEditor } from "./forms";

export const metadata: Metadata = { title: "Horários e feriados" };
const WD = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default async function SchedulesPage() {
  const ctx = await requireCompany("schedules.manage");
  const tz = ctx.company.timezone;
  const schedules = await db.select().from(workSchedules).where(eq(workSchedules.companyId, ctx.company.id)).orderBy(asc(workSchedules.name));
  const ids = schedules.map((s) => s.id);
  const [rules, usage, hols] = await Promise.all([
    ids.length ? db.select().from(scheduleRules).where(inArray(scheduleRules.scheduleId, ids)).orderBy(asc(scheduleRules.weekday)) : [],
    ids.length ? db.select({ id: shiftAssignments.scheduleId, n: count() }).from(shiftAssignments).where(inArray(shiftAssignments.scheduleId, ids)).groupBy(shiftAssignments.scheduleId) : [],
    db.select().from(holidays).where(eq(holidays.companyId, ctx.company.id)).orderBy(asc(holidays.date)),
  ]);

  return (
    <>
      <PageHeader title="Horários e feriados" description="Escalas semanais, tolerâncias, intervalos e turnos nocturnos." actions={<ScheduleEditor />} />
      <PageBody>
        <Notice tone="info">
          Um horário com fim anterior ao início (ex.: 22:00–06:00) é tratado como turno que atravessa a meia-noite: a saída conta para o dia da entrada.
        </Notice>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {schedules.map((s) => {
            const r = rules.filter((x) => x.scheduleId === s.id);
            return (
              <Card key={s.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold">{s.name}</p>
                    <p className="text-xs text-muted">Tolerância {s.toleranceMinutes} min · {usage.find((u) => u.id === s.id)?.n ?? 0} atribuições</p>
                  </div>
                  <ScheduleEditor schedule={{ id: s.id, name: s.name, toleranceMinutes: s.toleranceMinutes, rules: r.map((x) => ({ weekday: x.weekday, startTime: x.startTime.slice(0, 5), endTime: x.endTime.slice(0, 5), breakMinutes: x.breakMinutes })) }} />
                </div>
                <ul className="mt-4 grid grid-cols-7 gap-1 text-center">
                  {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                    const rule = r.find((x) => x.weekday === wd);
                    return (
                      <li key={wd} className={`rounded-md px-0.5 py-2 ${rule ? "bg-primary-soft text-primary" : "bg-surface text-subtle"}`}>
                        <span className="block text-[11px] font-medium">{WD[wd]}</span>
                        <span className="mt-1 block text-[10px] leading-tight tabular">{rule ? `${rule.startTime.slice(0, 5)}` : "—"}</span>
                        <span className="block text-[10px] leading-tight tabular">{rule ? `${rule.endTime.slice(0, 5)}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
                {r.some((x) => x.endTime <= x.startTime) ? <Badge tone="info" className="mt-3 self-start">Turno nocturno</Badge> : null}
              </Card>
            );
          })}
        </div>

        <section>
          <SectionTitle title="Feriados" description="Feriados recorrentes repetem-se todos os anos. Confirme o calendário oficial anual." action={<HolidayForm />} />
          <Card>
            <ul className="divide-y divide-border">
              {hols.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <span className="flex items-center gap-3">
                    <span className="w-24 text-muted tabular">{h.recurring ? new Date(`${h.date}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "long", timeZone: "UTC" }) : formatDate(h.date, tz)}</span>
                    <span className="font-medium">{h.name}</span>
                    {h.recurring ? <Badge>Anual</Badge> : null}
                  </span>
                  <ActionButton size="sm" variant="ghost" action={removeHolidayAction.bind(null, h.id)} confirm={`Remover "${h.name}"?`}>Remover</ActionButton>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </PageBody>
    </>
  );
}
