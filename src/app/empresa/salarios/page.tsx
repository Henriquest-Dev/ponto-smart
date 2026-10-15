import { asc, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, Check, Download, Lock, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { employees, payrollItems, payrollLines, payrollPeriods, payrollRuns, payslips, salaryPayments, users } from "@/lib/db/schema";
import { attendancePendings } from "@/lib/domain/payroll/service";
import { formatDate, formatDateTime, formatMoney, periodLabel } from "@/lib/format";
import { DAILY_STATUS_LABEL, PAYMENT_METHODS, PERIOD_STATUS, RUN_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  approveRunAction, closeAttendanceAction, closePeriodAction, issuePayslipsAction, prepareRunAction, reopenAttendanceAction,
} from "./actions";
import { NewPeriod, PayAll, PayItem } from "./forms";

export const metadata: Metadata = { title: "Salários" };

const STEPS = ["Assiduidade", "Pré-processamento", "Aprovação", "Recibos", "Pagamentos"];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ periodo?: string; run?: string }> }) {
  const ctx = await requireCompany("payroll.view");
  const tz = ctx.company.timezone;
  const cur = ctx.company.currency;
  const sp = await searchParams;
  const periods = await db.select().from(payrollPeriods).where(eq(payrollPeriods.companyId, ctx.company.id)).orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month));
  const period = periods.find((p) => p.id === sp.periodo) ?? [...periods].reverse().find((p) => p.status !== "closed") ?? periods[0];

  if (!period) {
    return (
      <>
        <PageHeader title="Salários" actions={can(ctx, "payroll.prepare") ? <NewPeriod /> : null} />
        <PageBody>
          <EmptyState icon={<Wallet />} title="Sem períodos salariais" description="Crie o primeiro período para começar." />
        </PageBody>
      </>
    );
  }

  const runs = await db
    .select({ r: payrollRuns, preparer: users.name })
    .from(payrollRuns)
    .innerJoin(users, eq(users.id, payrollRuns.preparedBy))
    .where(eq(payrollRuns.periodId, period.id))
    .orderBy(desc(payrollRuns.version));
  const approvers = runs.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, runs.map((r) => r.r.approvedBy).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])))
    : [];
  const run = runs.find((r) => r.r.id === sp.run) ?? runs.find((r) => r.r.status !== "superseded") ?? runs[0];
  const pendings = period.status === "open" ? await attendancePendings(ctx.company.id, period.year, period.month) : [];

  const items = run
    ? await db
        .select({ i: payrollItems, name: employees.fullName, code: employees.employeeCode })
        .from(payrollItems)
        .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
        .where(eq(payrollItems.runId, run.r.id))
        .orderBy(asc(employees.employeeCode))
    : [];
  const itemIds = items.map((i) => i.i.id);
  const [lines, slips, payments] = itemIds.length
    ? await Promise.all([
        db.select().from(payrollLines).where(inArray(payrollLines.payrollItemId, itemIds)).orderBy(asc(payrollLines.sort)),
        db.select().from(payslips).where(inArray(payslips.payrollItemId, itemIds)),
        db.select().from(salaryPayments).where(inArray(salaryPayments.payrollItemId, itemIds)),
      ])
    : [[], [], []];

  const approved = run?.r.status === "approved";
  const issued = approved && slips.length === items.length && items.length > 0;
  const paidCount = new Set(payments.map((p) => p.payrollItemId)).size;
  const stepIndex = period.status === "open" ? 0 : !run || run.r.status === "superseded" ? 1 : run.r.status === "draft" ? 2 : !issued ? 3 : 4;
  const isPreparer = run?.r.preparedBy === ctx.user.id;

  return (
    <>
      <PageHeader
        title="Salários"
        description={`${periodLabel(period.year, period.month)} · ${PERIOD_STATUS[period.status].label}`}
        actions={
          <>
            <form className="flex">
              <select
                name="periodo"
                defaultValue={period.id}
                className="h-10 rounded-l-md border border-r-0 border-border-strong bg-background px-3 text-[13px]"
                aria-label="Período"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{periodLabel(p.year, p.month)}</option>
                ))}
              </select>
              <Button type="submit" variant="outline" className="rounded-l-none">Ver</Button>
            </form>
            {can(ctx, "payroll.prepare") ? <NewPeriod /> : null}
          </>
        }
      />
      <PageBody>
        {/* Fluxo */}
        <ol className="grid grid-cols-5 gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <div className={cn("h-1.5 rounded-full", i < stepIndex ? "bg-primary" : i === stepIndex ? "bg-primary/40" : "bg-surface-2")} />
              <p className={cn("mt-2 truncate text-[11px] sm:text-xs", i <= stepIndex ? "font-medium text-foreground" : "text-subtle")}>
                {i + 1}. {s}
              </p>
            </li>
          ))}
        </ol>

        <Notice tone="warning">
          Os cálculos dependem de regras legais e fiscais que requerem validação por especialista laboral e contabilístico moçambicano.
          Retenções só são aplicadas a partir de regras marcadas como validadas em <Link className="font-semibold underline" href="/empresa/salarios/rubricas">Rubricas e regras</Link>. Nenhuma multa por atraso é aplicada.
        </Notice>

        {/* Passo 1 — assiduidade */}
        {period.status === "open" ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Fechar assiduidade</CardTitle>
                <p className="mt-0.5 text-[13px] text-muted">Resolva as pendências do período antes de calcular.</p>
              </div>
              {can(ctx, "payroll.prepare") ? (
                <ActionButton action={closeAttendanceAction.bind(null, period.id)} disabled={pendings.length > 0} confirm="Fechar a assiduidade bloqueia correcções neste período. Continuar?">
                  <Lock /> Fechar assiduidade
                </ActionButton>
              ) : null}
            </CardHeader>
            <CardContent>
              {pendings.length ? (
                <>
                  <p className="mb-3 flex items-center gap-2 text-[13px] font-medium text-warning">
                    <AlertTriangle className="size-4" /> {pendings.length} pendências
                  </p>
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {pendings.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                        <span className="font-medium">{p.employeeName}</span>
                        <span className="flex items-center gap-3 text-muted">
                          {formatDate(p.workDate, tz)} <Badge tone="warning">{DAILY_STATUS_LABEL[p.status]}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button variant="link" asChild className="mt-3">
                    <Link href="/empresa/assiduidade?estado=pendentes">Resolver na assiduidade</Link>
                  </Button>
                </>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-success"><Check className="size-4" /> Sem pendências. Pode fechar a assiduidade.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {period.status === "attendance_closed" && (!run || run.r.status === "superseded") ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="text-[15px] font-semibold">Assiduidade fechada</p>
              <p className="text-[13px] text-muted">Gere o pré-processamento a partir de contratos, rubricas e assiduidade.</p>
            </div>
            {can(ctx, "payroll.prepare") ? (
              <div className="flex gap-2">
                <ActionButton variant="outline" action={reopenAttendanceAction.bind(null, period.id)} confirm="Reabrir a assiduidade?">Reabrir</ActionButton>
                <ActionButton action={prepareRunAction.bind(null, period.id)}>Gerar pré-processamento</ActionButton>
              </div>
            ) : null}
          </Card>
        ) : null}

        {run ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-semibold tracking-tight">Execução v{run.r.version}</h2>
                <Badge tone={RUN_STATUS[run.r.status].tone}>{RUN_STATUS[run.r.status].label}</Badge>
                <span className="text-xs text-muted">
                  Preparado por {run.preparer} · {formatDateTime(run.r.preparedAt, tz)}
                  {run.r.approvedBy ? ` · aprovado por ${approvers.find((a) => a.id === run.r.approvedBy)?.name ?? "—"} em ${formatDateTime(run.r.approvedAt, tz)}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {can(ctx, "reports.export") ? (
                  <Button variant="outline" asChild>
                    <a href={`/api/reports/payroll/${run.r.id}`}><Download /> Excel</a>
                  </Button>
                ) : null}
                {run.r.status === "draft" && can(ctx, "payroll.prepare") ? (
                  <>
                    <ActionButton variant="outline" action={prepareRunAction.bind(null, period.id)}>Recalcular (nova versão)</ActionButton>
                    <ActionButton variant="outline" action={reopenAttendanceAction.bind(null, period.id)} confirm="Reabrir a assiduidade substitui este rascunho. Continuar?">Reabrir assiduidade</ActionButton>
                  </>
                ) : null}
                {run.r.status === "draft" && can(ctx, "payroll.approve") ? (
                  <ActionButton action={approveRunAction.bind(null, run.r.id)} disabled={isPreparer} confirm="Aprovar torna a execução imutável. Confirma que reviu os valores?">
                    <Check /> Aprovar
                  </ActionButton>
                ) : null}
                {approved && !issued && can(ctx, "payslips.issue") ? <ActionButton action={issuePayslipsAction.bind(null, run.r.id)}>Emitir recibos</ActionButton> : null}
                {approved && issued && paidCount < items.length && can(ctx, "payments.register") ? <PayAll runId={run.r.id} /> : null}
                {period.status === "approved" && issued && paidCount === items.length && can(ctx, "payroll.approve") ? (
                  <ActionButton variant="outline" action={closePeriodAction.bind(null, period.id)}>Encerrar período</ActionButton>
                ) : null}
              </div>
            </div>
            {run.r.status === "draft" && isPreparer && can(ctx, "payroll.approve") ? (
              <Notice tone="info">Separação de funções: preparou esta execução, por isso a aprovação tem de ser feita por outra pessoa.</Notice>
            ) : null}

            <StatRow>
              <Stat label="Colaboradores" value={run.r.totals.employees} />
              <Stat label="Total ilíquido" value={formatMoney(run.r.totals.gross, cur)} />
              <Stat label="Descontos" value={formatMoney(run.r.totals.deductions, cur)} />
              <Stat label="Total líquido" value={formatMoney(run.r.totals.net, cur)} hint={approved ? `${paidCount}/${items.length} pagamentos registados` : undefined} />
            </StatRow>

            {run.r.warnings.length ? (
              <Notice tone="warning" title={`${run.r.warnings.length} avisos do motor salarial`}>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {run.r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
                </ul>
              </Notice>
            ) : null}

            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Colaborador</TH>
                    <TH className="text-right">Ilíquido</TH>
                    <TH className="text-right">Descontos</TH>
                    <TH className="text-right">Líquido</TH>
                    <TH>Recibo</TH>
                    <TH>Pagamento</TH>
                  </tr>
                </THead>
                <tbody>
                  {items.map(({ i, name, code }) => {
                    const slip = slips.find((s) => s.payrollItemId === i.id);
                    const pay = payments.filter((p) => p.payrollItemId === i.id);
                    const itemLines = lines.filter((l) => l.payrollItemId === i.id);
                    return (
                      <TR key={i.id} className="align-top">
                        <TD>
                          <details>
                            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                              <span className="block font-medium">{name}</span>
                              <span className="block text-xs text-muted">{code} · ver linhas</span>
                            </summary>
                            <table className="mt-2 w-full min-w-[420px] text-xs">
                              <tbody>
                                {itemLines.map((l) => (
                                  <tr key={l.id} className="border-t border-border">
                                    <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{l.code}</td>
                                    <td className="py-1.5 pr-2">{l.description}</td>
                                    <td className="py-1.5 pr-2 text-muted tabular">{l.quantity ? Number(l.quantity).toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : ""}{l.rate ? ` × ${/%$/.test(l.rate) ? l.rate : Number(l.rate).toLocaleString("pt-PT", { maximumFractionDigits: 2 })}` : ""}</td>
                                    <td className={cn("py-1.5 text-right tabular", l.nature === "deduction" && "text-danger")}>
                                      {l.nature === "deduction" ? "−" : ""}{formatMoney(l.amount, cur)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(i.gross, cur)}</TD>
                        <TD className="text-right text-muted tabular">{formatMoney(i.deductions, cur)}</TD>
                        <TD className="text-right font-semibold tabular">{formatMoney(i.net, cur)}</TD>
                        <TD>{slip ? <a className="text-[13px] font-medium text-primary" href={`/api/payslips/${slip.id}`} target="_blank" rel="noreferrer">PDF</a> : <span className="text-muted">—</span>}</TD>
                        <TD>
                          {pay.length ? (
                            <span className="text-xs">
                              <Badge tone="success">Pago</Badge>
                              <span className="mt-1 block text-muted">{formatDate(pay[0].paidAt, tz)} · {PAYMENT_METHODS[pay[0].method] ?? pay[0].method}</span>
                            </span>
                          ) : approved && can(ctx, "payments.register") ? (
                            <PayItem itemId={i.id} amount={i.net} name={name} />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

            {runs.length > 1 ? (
              <div>
                <p className="mb-2 text-[13px] font-medium">Versões deste período</p>
                <div className="flex flex-wrap gap-2">
                  {runs.map((r) => (
                    <Link key={r.r.id} href={`?periodo=${period.id}&run=${r.r.id}`} className={cn("rounded-md border px-3 py-1.5 text-xs", r.r.id === run.r.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface")}>
                      v{r.r.version} · {RUN_STATUS[r.r.status].label} · {formatMoney(r.r.totals.net, cur)}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="text-xs text-subtle">
              Motor {run.r.engineVersion} · hash de integridade dos dados de entrada <span className="font-mono">{run.r.inputHash.slice(0, 24)}…</span>
            </p>
          </>
        ) : null}
      </PageBody>
    </>
  );
}
