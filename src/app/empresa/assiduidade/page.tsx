"use client";

import { CalendarCheck2 } from "lucide-react";
import { useState } from "react";
import { AttendanceNav } from "@/components/company/p1-attendance-nav";
import { ClassifyDayDialog } from "@/components/company/p1-employee-forms";
import { LoadingRows, todayIn, useOrgOptions } from "@/components/company/p1-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { DailyStatus } from "@/lib/domain/attendance-rules";
import { formatDate, formatMinutes, formatTime } from "@/lib/format";
import { dailyStatus } from "@/lib/labels";
import { attempt } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { addDays } from "@/lib/time";

type Estado = "todos" | "pendentes" | "atrasos" | "faltas";
const FILTERS: Record<Estado, DailyStatus[] | null> = {
  todos: null,
  pendentes: ["absent_pending", "incomplete", "review"],
  atrasos: ["late"],
  faltas: ["absent_pending", "unjustified", "justified"],
};
const LIMIT = 500;

type Row = {
  id: string;
  employee_id: string;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  status: DailyStatus;
  locked: boolean;
  employees: { full_name: string; employee_code: string; department_id: string | null; departments: { name: string } | null } | null;
};

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default function AttendancePage() {
  const { companyId, can, tz } = useCompany();
  const today = todayIn(tz);
  const qEstado = useQueryParam("estado");
  const qData = useQueryParam("data");
  const initialEstado: Estado = qEstado && qEstado in FILTERS ? (qEstado as Estado) : "todos";
  // Pendências: últimos 45 dias por defeito; restantes: o dia escolhido (hoje).
  const [estado, setEstado] = useState<Estado>(initialEstado);
  const [from, setFrom] = useState(isDate(qData) ? qData : initialEstado === "pendentes" ? addDays(today, -45) : today);
  const [to, setTo] = useState(isDate(qData) ? qData : today);
  const [dep, setDep] = useState("");
  const org = useOrgOptions();
  const manage = can("attendance.manage");

  const range = { from: from <= to ? from : to, to: from <= to ? to : from };

  const list = useData(async () => {
    let qb = sb()
      .from("attendance_daily")
      .select(
        "id,employee_id,work_date,first_in,last_out,worked_minutes,late_minutes,status,locked,employees!inner(full_name,employee_code,department_id,departments(name))",
      )
      .eq("company_id", companyId)
      .gte("work_date", range.from)
      .lte("work_date", range.to);
    const statuses = FILTERS[estado];
    if (statuses) qb = qb.in("status", statuses);
    if (dep) qb = qb.eq("employees.department_id", dep);
    const rows = must(await qb.order("work_date", { ascending: false }).limit(LIMIT)) as unknown as Row[];
    return rows.sort((a, b) => b.work_date.localeCompare(a.work_date) || (a.employees?.full_name ?? "").localeCompare(b.employees?.full_name ?? ""));
  }, [companyId, range.from, range.to, estado, dep]);

  const rows = list.data ?? [];
  const count = (s: DailyStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const editable = (r: Row) => manage && !r.locked && !["holiday", "day_off"].includes(r.status);

  return (
    <>
      <PageHeader
        title="Assiduidade"
        description="Registos diários consolidados a partir das marcações."
        actions={<ConsolidateDays companyId={companyId} onDone={list.reload} />}
      />
      <PageBody>
        <AttendanceNav active="registos" />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <label className="flex flex-col gap-1 text-xs text-muted">
              De
              <Input type="date" value={from} max={today} onChange={(e) => e.target.value && setFrom(e.target.value)} className="sm:w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Até
              <Input type="date" value={to} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="sm:w-40" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Estado
              <Select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} className="sm:w-44">
                <option value="todos">Todos</option>
                <option value="pendentes">Pendências</option>
                <option value="atrasos">Atrasos</option>
                <option value="faltas">Faltas</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Departamento
              <Select value={dep} onChange={(e) => setDep(e.target.value)} className="sm:w-48">
                <option value="">Todos</option>
                {org.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </label>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom(today);
                setTo(today);
              }}
            >
              Hoje
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom(addDays(today, -6));
                setTo(today);
              }}
            >
              7 dias
            </Button>
          </div>
        </div>

        <StatRow>
          <Stat
            label="Registos"
            value={list.data ? rows.length : "—"}
            hint={range.from === range.to ? formatDate(range.from, tz) : `${formatDate(range.from, tz)} – ${formatDate(range.to, tz)}`}
          />
          <Stat label="Pontuais" value={list.data ? count(["on_time", "present"]) : "—"} />
          <Stat label="Atrasos" value={list.data ? count(["late"]) : "—"} />
          <Stat label="Pendências" value={list.data ? count(["absent_pending", "incomplete", "review"]) : "—"} />
        </StatRow>

        {list.error ? (
          <Notice tone="danger">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck2 />}
            title="Sem registos para estes filtros"
            description="Os dias sem marcação passam a falta pendente quando o dia é consolidado (automaticamente ao abrir o painel)."
          />
        ) : (
          <div className={list.loading ? "opacity-60 transition-opacity" : undefined}>
            {rows.length >= LIMIT ? (
              <Notice tone="info" className="mb-3">
                A mostrar os {LIMIT} registos mais recentes. Reduza o intervalo para ver todos.
              </Notice>
            ) : null}
            {/* Telemóvel */}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border md:hidden">
              {rows.map((d) => {
                const st = dailyStatus(d.status);
                const name = d.employees?.full_name ?? "—";
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={name} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{name}</p>
                      <p className="truncate text-xs text-muted tabular">
                        {formatDate(d.work_date, tz)} · {d.first_in ? `${formatTime(d.first_in, tz)} → ${d.last_out ? formatTime(d.last_out, tz) : "…"}` : "sem marcações"}
                        {d.late_minutes ? ` · +${d.late_minutes} min` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {editable(d) ? (
                        <ClassifyDayDialog
                          dailyId={d.id}
                          name={name}
                          date={formatDate(d.work_date, tz)}
                          onDone={list.reload}
                          trigger={<button type="button" className="text-xs font-medium text-primary">Corrigir</button>}
                        />
                      ) : d.locked ? (
                        <span className="text-[11px] text-subtle">Fechado</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Desktop */}
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Colaborador</TH>
                    <TH>Data</TH>
                    <TH>Entrada</TH>
                    <TH>Saída</TH>
                    <TH>Trabalhado</TH>
                    <TH>Atraso</TH>
                    <TH>Estado</TH>
                    {manage ? <TH className="text-right">Acções</TH> : null}
                  </tr>
                </THead>
                <tbody>
                  {rows.map((d) => {
                    const st = dailyStatus(d.status);
                    const name = d.employees?.full_name ?? "—";
                    return (
                      <TR key={d.id}>
                        <TD>
                          <div className="flex items-center gap-3">
                            <Avatar name={name} size={30} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{name}</span>
                              <span className="block truncate text-xs text-muted">{d.employees?.departments?.name ?? "—"}</span>
                            </span>
                          </div>
                        </TD>
                        <TD className="text-muted tabular">{formatDate(d.work_date, tz)}</TD>
                        <TD className="tabular">{formatTime(d.first_in, tz)}</TD>
                        <TD className="tabular">{formatTime(d.last_out, tz)}</TD>
                        <TD className="tabular">{formatMinutes(d.worked_minutes)}</TD>
                        <TD className="text-muted tabular">{d.late_minutes ? `${d.late_minutes} min` : "—"}</TD>
                        <TD>
                          <span className="flex items-center gap-1.5">
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {d.locked ? <Badge>Fechado</Badge> : null}
                          </span>
                        </TD>
                        {manage ? (
                          <TD className="text-right">
                            {editable(d) ? <ClassifyDayDialog dailyId={d.id} name={name} date={formatDate(d.work_date, tz)} onDone={list.reload} /> : null}
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        )}
      </PageBody>
    </>
  );
}

/** Consolida os dias anteriores (faltas pendentes e registos incompletos). */
function ConsolidateDays({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Consolidar dias</Button>
      </DialogTrigger>
      <DialogContent
        title="Consolidar dias anteriores"
        description="Cria faltas pendentes para quem tinha horário e não marcou, e assinala registos sem saída. Pode ser repetido sem duplicar."
      >
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const days = Math.min(31, Math.max(1, Number(fd.get("days")) || 7));
              await rpc("ps_close_pending_days", { p_company: companyId, p_days: days });
              return `Últimos ${days} ${days === 1 ? "dia consolidado" : "dias consolidados"}.`;
            })
          }
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
          className="space-y-4"
        >
          <Field label="Dias para trás" hint="Entre 1 e 31. O dia de hoje não é fechado.">
            <Input type="number" name="days" min={1} max={31} defaultValue={7} required />
          </Field>
          <SubmitButton className="w-full" pendingText="A processar…">
            Consolidar
          </SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
