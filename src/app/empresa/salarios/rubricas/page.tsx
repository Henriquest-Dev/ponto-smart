"use client";

import * as React from "react";
import { ErrorBlock, LoadingBlock, NoAccess, todayIn } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { RuleParams } from "@/lib/domain/payroll/engine";
import { formatDate, formatMoney } from "@/lib/format";
import { attempt, formObject } from "@/lib/result";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";

const CALC: Record<string, string> = { fixed: "Valor fixo", percent_base: "% do salário base", per_hour: "Por hora (multiplicador)" };
const KIND: Record<string, string> = {
  employee_contribution: "Contribuição do trabalhador",
  income_tax: "Imposto sobre o rendimento",
  employer_contribution: "Encargo da entidade",
};

type Component = {
  id: string;
  code: string;
  name: string;
  nature: "earning" | "deduction";
  calc_type: "fixed" | "percent_base" | "per_hour";
  rate: string | number | null;
  taxable: boolean;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
};

type RuleVersion = {
  id: string;
  company_id: string | null;
  rule_code: string;
  name: string;
  version: number;
  params: RuleParams;
  effective_from: string;
  effective_to: string | null;
  validated: boolean;
  validated_by: string | null;
  source_reference: string | null;
};

export default function ComponentsPage() {
  const { can } = useCompany();
  if (!can("payroll.view")) return <NoAccess title="Rubricas e regras" />;
  return <Components />;
}

function Components() {
  const { companyId, can, tz, company } = useCompany();
  const canEdit = can("payroll.prepare");
  const data = useData(async () => {
    const [components, rules] = await Promise.all([
      sb().from("payroll_components").select("id,code,name,nature,calc_type,rate,taxable,effective_from,effective_to,active").eq("company_id", companyId).order("code"),
      sb()
        .from("payroll_rule_versions")
        .select("id,company_id,rule_code,name,version,params,effective_from,effective_to,validated,validated_by,source_reference")
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .order("rule_code")
        .order("version", { ascending: false }),
    ]);
    return { components: must(components) as Component[], rules: must(rules) as RuleVersion[] };
  }, [companyId]);

  const pending = (data.data?.rules ?? []).filter((r) => !r.validated);

  return (
    <>
      <PageHeader title="Rubricas e regras" description="Catálogo de abonos e descontos, e regras legais versionadas." />
      <PageBody>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data && !data.error ? <LoadingBlock rows={4} /> : null}
        {data.data ? (
          <>
            <section>
              <SectionTitle
                title="Rubricas"
                description="Atribuídas por colaborador na respectiva ficha. A rubrica por hora define o pagamento de horas extra."
                action={canEdit ? <NewComponent onDone={data.reload} /> : null}
              />
              {data.data.components.length === 0 ? (
                <EmptyState title="Sem rubricas" description="Crie subsídios, adiantamentos ou descontos autorizados." />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Código</TH><TH>Nome</TH><TH>Natureza</TH><TH>Cálculo</TH><TH>Valor / taxa</TH><TH>Tributável</TH><TH>Vigência</TH><TH>Estado</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {data.data.components.map((c) => (
                        <TR key={c.id}>
                          <TD className="font-mono text-xs">{c.code}</TD>
                          <TD className="font-bold">{c.name}</TD>
                          <TD>{c.nature === "earning" ? <Badge tone="success">Abono</Badge> : <Badge tone="danger">Desconto</Badge>}</TD>
                          <TD className="text-muted">{CALC[c.calc_type]}</TD>
                          <TD className="tabular">
                            {c.rate != null
                              ? c.calc_type === "fixed"
                                ? formatMoney(c.rate, company.currency)
                                : c.calc_type === "percent_base"
                                  ? `${Number(c.rate).toLocaleString("pt-PT")}%`
                                  : `${Number(c.rate).toLocaleString("pt-PT")}×`
                              : "Por colaborador"}
                          </TD>
                          <TD className="text-muted">{c.taxable ? "Sim" : "Não"}</TD>
                          <TD className="whitespace-nowrap text-muted">
                            desde {formatDate(c.effective_from, tz)}
                            {c.effective_to ? ` até ${formatDate(c.effective_to, tz)}` : ""}
                          </TD>
                          <TD>
                            {canEdit ? (
                              <span className="flex items-center gap-2">
                              <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Activa" : "Inactiva"}</Badge>
                              <ActionButton
                                size="sm"
                                variant="ghost"
                                action={() =>
                                  attempt(async () => {
                                    must(await sb().from("payroll_components").update({ active: !c.active }).eq("id", c.id).select("id"));
                                    data.reload();
                                    return c.active ? "Rubrica desactivada." : "Rubrica activada.";
                                  })
                                }
                              >
                                {c.active ? "Desactivar" : "Activar"}
                              </ActionButton>
                              </span>
                            ) : (
                              <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Activa" : "Inactiva"}</Badge>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </section>

            <section>
              <SectionTitle title="Regras legais e fiscais" description="Versões imutáveis. O motor só aplica a versão mais recente marcada como validada." />
              <div className="mb-3 space-y-3">
                <Notice tone="warning">
                  O Horbit não inclui taxas de INSS ou tabelas de IRPS pré-definidas. As regras são registadas pelo suporte da plataforma após verificação por
                  especialista laboral/contabilístico, com indicação de quem validou e da fonte legal.
                </Notice>
                {pending.length ? (
                  <Notice tone="danger" title={`${pending.length} ${pending.length === 1 ? "regra por validar" : "regras por validar"}`}>
                    Regras não validadas não são aplicadas no processamento: {pending.map((r) => `${r.name} (v${r.version})`).join(", ")}.
                  </Notice>
                ) : null}
              </div>
              {data.data.rules.length === 0 ? (
                <EmptyState title="Sem regras registadas" description="Sem regras validadas, o processamento não aplica retenções legais." />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Regra</TH><TH>Versão</TH><TH>Natureza</TH><TH>Parâmetros</TH><TH>Vigência</TH><TH>Origem</TH><TH>Validação</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {data.data.rules.map((r) => (
                        <TR key={r.id}>
                          <TD>
                            <span className="block font-bold">{r.name}</span>
                            <span className="font-mono text-xs text-muted">{r.rule_code}</span>
                            {r.source_reference ? <span className="block text-xs text-subtle">{r.source_reference}</span> : null}
                          </TD>
                          <TD className="tabular">v{r.version}</TD>
                          <TD className="text-muted">{KIND[r.params?.kind] ?? r.params?.kind ?? "—"}</TD>
                          <TD className="text-xs text-muted">
                            {r.params?.ratePercent != null
                              ? `${r.params.ratePercent}%`
                              : r.params?.brackets?.length
                                ? `${r.params.brackets.length} escalões`
                                : "Por definir"}
                          </TD>
                          <TD className="whitespace-nowrap text-muted">desde {formatDate(r.effective_from, tz)}</TD>
                          <TD>{r.company_id ? <Badge tone="primary">Empresa</Badge> : <Badge>Plataforma</Badge>}</TD>
                          <TD>
                            {r.validated ? (
                              <span className="text-xs">
                                <Badge tone="success">Validada</Badge>
                                <span className="mt-1 block text-muted">{r.validated_by}</span>
                              </span>
                            ) : (
                              <Badge tone="warning">Por validar</Badge>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </section>
          </>
        ) : null}
      </PageBody>
    </>
  );
}

function NewComponent({ onDone }: { onDone: () => void }) {
  const { companyId, tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Nova rubrica</Button>
      </DialogTrigger>
      <DialogContent title="Nova rubrica">
        <ActionForm
          action={(_p, fd) =>
            attempt(async () => {
              const o = formObject(fd);
              const code = (o.code ?? "").toUpperCase();
              if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new Error("Código: 2–20 letras, números ou _.");
              if (!o.name || o.name.length < 3) throw new Error("Indique o nome da rubrica.");
              const rate = o.rate ? Number(o.rate.replace(",", ".")) : null;
              if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new Error("Valor de referência inválido.");
              must(
                await sb()
                  .from("payroll_components")
                  .insert({
                    company_id: companyId,
                    code,
                    name: o.name,
                    nature: o.nature,
                    calc_type: o.calcType,
                    rate,
                    taxable: o.taxable === "on",
                    effective_from: o.effectiveFrom,
                  })
                  .select("id"),
              );
              onDone();
              return "Rubrica criada.";
            })
          }
          onSuccess={() => setOpen(false)}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Código"><Input name="code" required placeholder="SUB_TURNO" className="uppercase" /></Field>
          <Field label="Nome"><Input name="name" required placeholder="Subsídio de turno" /></Field>
          <Field label="Natureza">
            <Select name="nature" defaultValue="earning">
              <option value="earning">Abono</option>
              <option value="deduction">Desconto autorizado</option>
            </Select>
          </Field>
          <Field label="Cálculo">
            <Select name="calcType" defaultValue="fixed">
              <option value="fixed">Valor fixo</option>
              <option value="percent_base">% do salário base</option>
              <option value="per_hour">Por hora (horas extra)</option>
            </Select>
          </Field>
          <Field label="Valor de referência" hint="Fixo: valor; %: percentagem; por hora: multiplicador."><Input name="rate" inputMode="decimal" /></Field>
          <Field label="Em vigor desde"><Input type="date" name="effectiveFrom" defaultValue={todayIn(tz)} required /></Field>
          <label className="flex items-center gap-2.5 text-[13px] sm:col-span-2"><Checkbox name="taxable" defaultChecked /> Entra na base das retenções</label>
          <div className="sm:col-span-2"><SubmitButton className="w-full">Criar rubrica</SubmitButton></div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
