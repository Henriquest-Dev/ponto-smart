"use client";

import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { exportPayrollRun } from "@/components/company/p2-reports";
import {
  approveRun, loadItems, loadLines, loadPeriods, loadRuns, loadSlipsAndPayments, payslipBlob, prepareRun,
  type Item, type Line, type Period, type Run, type Slip,
} from "@/components/company/p2-payroll";
import { ErrorBlock, LoadingBlock, NoAccess, monthBounds, todayIn } from "@/components/company/p2-shared";
import { StepStems } from "@/components/company/p2-steps";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadBlob } from "@/lib/excel";
import { formatDate, formatDateTime, formatMoney, periodLabel } from "@/lib/format";
import { DAILY_STATUS_LABEL, PAYMENT_METHODS, PERIOD_STATUS, RUN_STATUS } from "@/lib/labels";
import type { DailyStatus } from "@/lib/domain/attendance-rules";
import { attempt, formObject } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

const STEPS = ["Assiduidade", "Pré-processamento", "Aprovação", "Recibos", "Pagamentos"];

export default function PayrollPage() {
  const { can } = useCompany();
  if (!can("payroll.view")) return <NoAccess title="Salários" />;
  return <Payroll />;
}

type Pending = { id: string; work_date: string; status: DailyStatus; employees: { full_name: string } | null };

function Payroll() {
  const { companyId, can, tz, company } = useCompany();
  const cur = company.currency;
  const periods = useData(() => loadPeriods(companyId), [companyId]);
  const [periodId, setPeriodId] = React.useState<string | null>(null);
  const [runId, setRunId] = React.useState<string | null>(null);

  const list = periods.data ?? [];
  const period = list.find((p) => p.id === periodId) ?? [...list].reverse().find((p) => p.status !== "closed") ?? list[0];

  const newPeriod = can("payroll.prepare") ? (
    <NewPeriod
      onCreated={(id) => {
        setPeriodId(id);
        setRunId(null);
        periods.reload();
      }}
    />
  ) : null;

  if (periods.loading && !periods.data) {
    return (
      <>
        <PageHeader title="Salários" />
        <PageBody><LoadingBlock rows={4} /></PageBody>
      </>
    );
  }
  if (periods.error) {
    return (
      <>
        <PageHeader title="Salários" />
        <PageBody><ErrorBlock message={periods.error} /></PageBody>
      </>
    );
  }
  if (!period) {
    return (
      <>
        <PageHeader title="Salários" actions={newPeriod} />
        <PageBody>
          <EmptyState title="Sem períodos salariais" description="Crie o primeiro período para começar." />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Salários"
        description={`${periodLabel(period.year, period.month)}, ${(PERIOD_STATUS[period.status]?.label ?? period.status).toLowerCase()}`}
        actions={
          <>
            <Select
              value={period.id}
              onChange={(e) => {
                setPeriodId(e.target.value);
                setRunId(null);
              }}
              className="w-44"
              aria-label="Período"
            >
              {list.map((p) => (
                <option key={p.id} value={p.id}>{periodLabel(p.year, p.month)}</option>
              ))}
            </Select>
            {newPeriod}
          </>
        }
      />
      <PageBody>
        <PeriodView key={period.id} period={period} runId={runId} setRunId={setRunId} onPeriodChanged={periods.reload} currency={cur} tz={tz} />
      </PageBody>
    </>
  );
}

function PeriodView({
  period, runId, setRunId, onPeriodChanged, currency: cur, tz,
}: {
  period: Period;
  runId: string | null;
  setRunId: (id: string | null) => void;
  onPeriodChanged: () => void;
  currency: string;
  tz: string;
}) {
  const { companyId, can, me, company } = useCompany();

  const detail = useData(async () => {
    const runs = await loadRuns(period.id);
    let pendings: Pending[] = [];
    if (period.status === "open") {
      const { from, to } = monthBounds(`${period.year}-${String(period.month).padStart(2, "0")}`);
      pendings = must(
        await sb()
          .from("attendance_daily")
          .select("id,work_date,status,employees(full_name)")
          .eq("company_id", companyId)
          .gte("work_date", from)
          .lte("work_date", to)
          .in("status", ["absent_pending", "review", "incomplete"])
          .order("work_date")
          .limit(500),
      ) as unknown as Pending[];
    }
    return { runs, pendings };
  }, [period.id, period.status, companyId]);

  const runs = detail.data?.runs ?? [];
  const run = runs.find((r) => r.id === runId) ?? runs.find((r) => r.status !== "superseded") ?? runs[0];

  const items = useData(async () => {
    if (!run) return { items: [] as Item[], lines: [] as Line[], slips: [] as Slip[], payments: [] as Awaited<ReturnType<typeof loadSlipsAndPayments>>["payments"] };
    const its = await loadItems(run.id);
    const ids = its.map((i) => i.id);
    const [lines, sp] = ids.length ? await Promise.all([loadLines(ids), loadSlipsAndPayments(ids)]) : [[], { slips: [], payments: [] }];
    return { items: its, lines, slips: sp.slips, payments: sp.payments };
  }, [run?.id, run?.status]);

  const reloadAll = () => {
    onPeriodChanged();
    detail.reload();
    items.reload();
  };

  if (detail.error) return <ErrorBlock message={detail.error} />;
  if (!detail.data) return <LoadingBlock rows={4} />;

  const pendings = detail.data.pendings;
  const its = items.data?.items ?? [];
  const lines = items.data?.lines ?? [];
  const slips = items.data?.slips ?? [];
  const payments = items.data?.payments ?? [];
  const approved = run?.status === "approved";
  const issued = approved && its.length > 0 && slips.length >= its.length;
  const paidSet = new Set(payments.map((p) => p.payroll_item_id));
  const paidCount = its.filter((i) => paidSet.has(i.id)).length;
  const stepIndex = period.status === "open" ? 0 : !run || run.status === "superseded" ? 1 : run.status === "draft" ? 2 : !issued ? 3 : 4;
  const isPreparer = run?.prepared_by === me.id;

  const prepare = () =>
    attempt(async () => {
      const v = await prepareRun(companyId, period);
      setRunId(null);
      reloadAll();
      return `Pré-processamento v${v} gerado. Aguarda aprovação.`;
    });
  const reopen = () =>
    attempt(async () => {
      await rpc("ps_payroll_close_attendance", { p_period: period.id, p_reopen: true });
      setRunId(null);
      reloadAll();
      return "Assiduidade reaberta. Rascunhos anteriores foram substituídos.";
    });

  return (
    <>
      <StepStems steps={STEPS} current={stepIndex} />

      <Notice tone="warning">
        Os cálculos dependem de regras legais e fiscais que requerem validação por especialista laboral e contabilístico moçambicano.
        Retenções só são aplicadas a partir de regras marcadas como validadas em{" "}
        <Link className="font-bold underline decoration-2 underline-offset-2" href="/empresa/salarios/rubricas/">Rubricas e regras</Link>. Nenhuma multa por atraso é aplicada.
      </Notice>

      {period.status === "open" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fechar assiduidade</CardTitle>
              <p className="mt-0.5 text-[13px] text-muted">Resolva as pendências do período antes de calcular.</p>
            </div>
            {can("payroll.prepare") ? (
              <ActionButton
                action={() =>
                  attempt(async () => {
                    await rpc("ps_payroll_close_attendance", { p_period: period.id, p_reopen: false });
                    reloadAll();
                    return "Assiduidade fechada. Já pode gerar o pré-processamento.";
                  })
                }
                disabled={pendings.length > 0}
                confirm="Fechar a assiduidade bloqueia correcções neste período. Continuar?"
              >
                <span className="hidden sm:inline">Fechar assiduidade</span><span className="sm:hidden">Fechar</span>
              </ActionButton>
            ) : null}
          </CardHeader>
          <CardContent>
            {pendings.length ? (
              <>
                <p className="mb-3 flex items-center gap-2 text-[14px] font-bold text-warning">
                  <span className="stem" aria-hidden />
                  <span className="tabular font-extrabold">{pendings.length}{pendings.length >= 500 ? "+" : ""}</span> pendências por resolver
                </p>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-[16px] border border-border">
                  {pendings.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                      <span className="min-w-0 truncate font-bold">{p.employees?.full_name ?? "—"}</span>
                      <span className="flex shrink-0 items-center gap-3 text-muted">
                        {formatDate(p.work_date, tz)} <Badge tone="warning">{DAILY_STATUS_LABEL[p.status] ?? p.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
                <Button variant="link" asChild className="mt-3">
                  <Link href="/empresa/assiduidade/?estado=pendentes">Resolver na assiduidade</Link>
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[13.5px] font-bold text-success">
                <span className="stem" aria-hidden /> Sem pendências. Pode fechar a assiduidade.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {period.status === "attendance_closed" && (!run || run.status === "superseded") ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-l-[6px] border-l-primary p-5 sm:p-6">
          <div>
            <p className="text-[16px] font-extrabold tracking-[-0.01em]">Assiduidade fechada</p>
            <p className="text-[13px] text-muted">Gere o pré-processamento a partir de contratos, rubricas e assiduidade.</p>
          </div>
          {can("payroll.prepare") ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="outline" action={reopen} confirm="Reabrir a assiduidade?">Reabrir</ActionButton>
              <ActionButton action={prepare}>Gerar pré-processamento</ActionButton>
            </div>
          ) : null}
        </Card>
      ) : null}

      {run ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">Execução v{run.version}</h2>
                  <Badge tone={RUN_STATUS[run.status]?.tone}>{RUN_STATUS[run.status]?.label ?? run.status}</Badge>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  Preparado por {run.preparer?.name ?? "—"} em {formatDateTime(run.prepared_at, tz)}
                  {run.approved_by ? `, aprovado por ${run.approver?.name ?? "—"} em ${formatDateTime(run.approved_at, tz)}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {can("reports.export") || can("payroll.view") ? (
                <ActionButton
                  variant="outline"
                  action={() =>
                    attempt(async () => {
                      await exportPayrollRun(run.id, company.companyName);
                    })
                  }
                >
                  Descarregar Excel
                </ActionButton>
              ) : null}
              {run.status === "draft" && can("payroll.prepare") ? (
                <>
                  <ActionButton variant="outline" action={prepare}>Recalcular (nova versão)</ActionButton>
                  <ActionButton variant="outline" action={reopen} confirm="Reabrir a assiduidade substitui este rascunho. Continuar?">
                    Reabrir assiduidade
                  </ActionButton>
                </>
              ) : null}
              {run.status === "draft" && can("payroll.approve") ? (
                <ActionButton
                  action={() =>
                    attempt(async () => {
                      await approveRun(companyId, period, run.id);
                      reloadAll();
                      return "Processamento aprovado. A execução é agora imutável.";
                    })
                  }
                  disabled={isPreparer}
                  confirm="Aprovar torna a execução imutável. Confirma que reviu os valores?"
                >
                  Aprovar
                </ActionButton>
              ) : null}
              {approved && !issued && can("payslips.issue") && !items.loading ? (
                <ActionButton
                  action={() =>
                    attempt(async () => {
                      const n = await rpc<number>("ps_issue_payslips", { p_run: run.id });
                      items.reload();
                      return n ? `${n} recibos emitidos e colaboradores notificados.` : "Todos os recibos já estavam emitidos.";
                    })
                  }
                >
                  Emitir recibos
                </ActionButton>
              ) : null}
              {approved && issued && paidCount < its.length && can("payments.register") ? (
                <PayAll items={its.filter((i) => !paidSet.has(i.id) && Number(i.net) > 0)} onDone={items.reload} />
              ) : null}
              {approved && issued && period?.status === "approved" && can("payroll.approve") ? (
                <ActionButton
                  variant="outline"
                  confirm="Encerrar este período? Deixa de ser possível alterar a assiduidade e os salários do mês."
                  action={() =>
                    attempt(async () => {
                      await rpc("ps_payroll_close_period", { p_period: period.id });
                      onPeriodChanged();
                      return "Período encerrado.";
                    })
                  }
                >
                  Encerrar período
                </ActionButton>
              ) : null}
            </div>
          </div>

          {run.status === "draft" && isPreparer && can("payroll.approve") ? (
            <Notice tone="info">Separação de funções: preparou esta execução, por isso a aprovação tem de ser feita por outra pessoa.</Notice>
          ) : null}

          <StatRow>
            <Stat label="Colaboradores" value={run.totals?.employees ?? its.length} />
            <Stat label="Total ilíquido" value={formatMoney(run.totals?.gross, cur)} />
            <Stat label="Descontos" value={formatMoney(run.totals?.deductions, cur)} />
            <Stat label="Total líquido" value={formatMoney(run.totals?.net, cur)} hint={approved ? `${paidCount}/${its.length} pagamentos registados` : undefined} />
          </StatRow>

          {run.warnings?.length ? (
            <Notice tone="warning" title={`${run.warnings.length} avisos do motor salarial`}>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {run.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
            </Notice>
          ) : null}

          {items.error ? <ErrorBlock message={items.error} /> : null}
          {items.loading && !items.data ? (
            <Skeleton className="h-64 w-full rounded-[22px]" />
          ) : (
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
                  {its.map((i) => {
                    const slip = slips.find((s) => s.payroll_item_id === i.id);
                    const pay = payments.filter((p) => p.payroll_item_id === i.id);
                    const itemLines = lines.filter((l) => l.payroll_item_id === i.id).sort((a, b) => a.sort - b.sort);
                    const name = i.employees?.full_name ?? "—";
                    return (
                      <TR key={i.id} className="align-top">
                        <TD>
                          <details>
                            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                              <span className="block font-bold">{name}</span>
                              <span className="block text-xs text-muted">
                                {i.employees?.employee_code ? `${i.employees.employee_code}, ` : ""}
                                <span className="font-bold text-primary">ver linhas</span>
                              </span>
                            </summary>
                            <table className="mt-2 w-full min-w-[420px] text-xs">
                              <tbody>
                                {itemLines.map((l) => (
                                  <tr key={l.id} className="border-t border-border">
                                    <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{l.code}</td>
                                    <td className="py-1.5 pr-2">{l.description}</td>
                                    <td className="py-1.5 pr-2 text-muted tabular">{lineQty(l)}</td>
                                    <td className={cn("py-1.5 text-right tabular", l.nature === "deduction" && "text-danger")}>
                                      {l.nature === "deduction" ? "−" : ""}
                                      {formatMoney(l.amount, cur)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(i.gross, cur)}</TD>
                        <TD className="text-right text-muted tabular">{formatMoney(i.deductions, cur)}</TD>
                        <TD className="text-right font-extrabold tabular">{formatMoney(i.net, cur)}</TD>
                        <TD>
                          {slip ? (
                            <PayslipButton companyId={companyId} period={period} run={run} item={i} lines={itemLines} slip={slip} />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </TD>
                        <TD>
                          {pay.length ? (
                            <span className="text-xs">
                              <Badge tone="success">Pago</Badge>
                              <span className="mt-1 block text-muted">{formatDate(pay[0].paid_at, tz)}</span>
                              <span className="block text-muted">{PAYMENT_METHODS[pay[0].method] ?? pay[0].method}</span>
                            </span>
                          ) : approved && can("payments.register") ? (
                            <PayItem item={i} currency={cur} onDone={items.reload} />
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
          )}

          {runs.length > 1 ? (
            <div>
              <p className="mb-2 text-[14px] font-extrabold">Versões deste período</p>
              <div className="flex flex-wrap gap-2">
                {runs.map((r: Run) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRunId(r.id)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-full border-2 px-4 py-1.5 text-[12.5px] font-bold transition-colors",
                      r.id === run.id ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:border-foreground hover:text-foreground",
                    )}
                  >
                    <span className="font-extrabold">v{r.version}</span>
                    <span>{RUN_STATUS[r.status]?.label ?? r.status}</span>
                    <span className="tabular">{formatMoney(r.totals?.net, cur)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-subtle">
            Motor {run.engine_version}. Hash de integridade dos dados de entrada <span className="font-mono">{run.input_hash.slice(0, 24)}…</span>
          </p>
        </>
      ) : null}
    </>
  );
}

function lineQty(l: Line) {
  const n = (v: string) => Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
  const q = l.quantity ? n(l.quantity) : "";
  if (!l.rate) return q;
  // Regras legais e rubricas percentuais guardam a taxa como percentagem.
  const pct = l.origin === "rule" || (l.origin === "component" && l.quantity === l.rate);
  return `${q}${q ? " × " : ""}${pct ? `${n(l.rate)}%` : n(l.rate)}`;
}

function PayslipButton(props: { companyId: string; period: Period; run: Run; item: Item; lines: Line[]; slip: Slip }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3.5 text-[12.5px] font-bold text-primary hover:bg-[#e4dbfd] disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await payslipBlob(props);
          downloadBlob(blob, `recibo-${props.slip.reference}.pdf`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Não foi possível gerar o recibo.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="spinner" aria-hidden /> : null} Recibo PDF
    </button>
  );
}

function Methods() {
  return (
    <Select name="method" defaultValue="transferencia">
      {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </Select>
  );
}

function NewPeriod({ onCreated }: { onCreated: (id: string) => void }) {
  const { companyId, tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Novo período</Button>
      </DialogTrigger>
      <DialogContent title="Novo período salarial">
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const [y, m] = String(fd.get("month") ?? "").split("-").map(Number);
              if (!y || !m || m < 1 || m > 12) throw new Error("Mês inválido.");
              const id = await rpc<string>("ps_payroll_period", { p_company: companyId, p_year: y, p_month: m });
              onCreated(id);
              return "Período criado.";
            })
          }
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <Field label="Mês"><Input type="month" name="month" required defaultValue={todayIn(tz).slice(0, 7)} /></Field>
          <SubmitButton className="w-full">Criar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function PayItem({ item, currency, onDone }: { item: Item; currency: string; onDone: () => void }) {
  const { tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">Registar</Button>
      </DialogTrigger>
      <DialogContent title="Registar pagamento" description={`${item.employees?.full_name ?? ""}. O registo de pagamento é distinto da confirmação de recepção do recibo.`}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              const amount = Number(String(o.amount ?? "").replace(",", "."));
              if (!Number.isFinite(amount) || amount <= 0) throw new Error("Valor inválido.");
              await rpc("ps_register_payment", { p_item: item.id, p_amount: amount, p_paid_at: o.paidAt, p_method: o.method, p_reference: o.reference ?? null });
              onDone();
              return "Pagamento registado.";
            })
          }
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Valor (${currency})`}><Input name="amount" defaultValue={item.net} inputMode="decimal" required /></Field>
            <Field label="Data"><Input type="date" name="paidAt" defaultValue={todayIn(tz)} required /></Field>
          </div>
          <Field label="Método"><Methods /></Field>
          <Field label="Referência"><Input name="reference" maxLength={80} placeholder="Nº da transferência ou transacção" /></Field>
          <SubmitButton className="w-full">Registar pagamento</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function PayAll({ items, onDone }: { items: Item[]; onDone: () => void }) {
  const { tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registar pagamentos</Button>
      </DialogTrigger>
      <DialogContent title="Registar pagamentos em lote" description={`Regista o valor líquido de ${items.length} colaboradores ainda sem pagamento.`}>
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              let n = 0;
              try {
                for (const it of items) {
                  await rpc("ps_register_payment", { p_item: it.id, p_amount: Number(it.net), p_paid_at: o.paidAt, p_method: o.method, p_reference: o.reference ?? null });
                  n++;
                }
              } finally {
                onDone();
              }
              return `${n} pagamentos registados.`;
            })
          }
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <Field label="Data do pagamento"><Input type="date" name="paidAt" defaultValue={todayIn(tz)} required /></Field>
          <Field label="Método"><Methods /></Field>
          <Field label="Referência do lote"><Input name="reference" maxLength={80} placeholder="Ex.: lote bancário 2026-10" /></Field>
          <SubmitButton className="w-full">Registar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
