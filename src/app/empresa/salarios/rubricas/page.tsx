import { asc, desc, eq, isNull, or } from "drizzle-orm";
import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/card";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { payrollComponents, payrollRuleVersions } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { toggleComponentAction } from "../actions";
import { NewComponent, NewRuleVersion } from "./forms";

export const metadata: Metadata = { title: "Rubricas e regras" };

const CALC: Record<string, string> = { fixed: "Valor fixo", percent_base: "% do salário base", per_hour: "Por hora (multiplicador)" };
const KIND: Record<string, string> = { employee_contribution: "Contribuição do trabalhador", income_tax: "Imposto sobre o rendimento", employer_contribution: "Encargo da entidade" };

export default async function ComponentsPage() {
  const ctx = await requireCompany("payroll.view");
  const tz = ctx.company.timezone;
  const [components, rules] = await Promise.all([
    db.select().from(payrollComponents).where(eq(payrollComponents.companyId, ctx.company.id)).orderBy(asc(payrollComponents.code)),
    db
      .select()
      .from(payrollRuleVersions)
      .where(or(isNull(payrollRuleVersions.companyId), eq(payrollRuleVersions.companyId, ctx.company.id)))
      .orderBy(asc(payrollRuleVersions.ruleCode), desc(payrollRuleVersions.version)),
  ]);
  const canEdit = can(ctx, "payroll.prepare");

  return (
    <>
      <PageHeader title="Rubricas e regras" description="Catálogo de abonos e descontos, e regras legais versionadas." />
      <PageBody>
        <section>
          <SectionTitle title="Rubricas" description="Atribuídas por colaborador na respectiva ficha. A rubrica por hora define o pagamento de horas extra." action={canEdit ? <NewComponent /> : null} />
          <TableWrap>
            <Table>
              <THead>
                <tr><TH>Código</TH><TH>Nome</TH><TH>Natureza</TH><TH>Cálculo</TH><TH>Valor / taxa</TH><TH>Tributável</TH><TH>Vigência</TH><TH>Estado</TH></tr>
              </THead>
              <tbody>
                {components.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">{c.code}</TD>
                    <TD className="font-medium">{c.name}</TD>
                    <TD>{c.nature === "earning" ? <Badge tone="success">Abono</Badge> : <Badge tone="danger">Desconto</Badge>}</TD>
                    <TD className="text-muted">{CALC[c.calcType]}</TD>
                    <TD className="tabular">{c.rate ? (c.calcType === "fixed" ? formatMoney(c.rate) : c.calcType === "percent_base" ? `${c.rate}%` : `${c.rate}×`) : "Por colaborador"}</TD>
                    <TD className="text-muted">{c.taxable ? "Sim" : "Não"}</TD>
                    <TD className="text-muted">desde {formatDate(c.effectiveFrom, tz)}</TD>
                    <TD>
                      {canEdit ? (
                        <ActionButton size="sm" variant="ghost" action={toggleComponentAction.bind(null, c.id, !c.active)}>
                          {c.active ? "Activa · desactivar" : "Inactiva · activar"}
                        </ActionButton>
                      ) : (
                        <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Activa" : "Inactiva"}</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>

        <section>
          <SectionTitle
            title="Regras legais e fiscais"
            description="Versões imutáveis. O motor só aplica a versão mais recente marcada como validada."
            action={can(ctx, "payroll.prepare", "payroll.approve") ? <NewRuleVersion /> : null}
          />
          <Notice tone="warning" className="mb-3">
            O PontoSmart não inclui taxas de INSS ou tabelas de IRPS pré-definidas. Introduza os valores vigentes apenas após verificação por especialista laboral/contabilístico, indicando quem validou e a fonte.
          </Notice>
          <TableWrap>
            <Table>
              <THead>
                <tr><TH>Regra</TH><TH>Versão</TH><TH>Natureza</TH><TH>Parâmetros</TH><TH>Vigência</TH><TH>Origem</TH><TH>Validação</TH></tr>
              </THead>
              <tbody>
                {rules.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="block font-medium">{r.name}</span>
                      <span className="font-mono text-xs text-muted">{r.ruleCode}</span>
                    </TD>
                    <TD className="tabular">v{r.version}</TD>
                    <TD className="text-muted">{KIND[r.params.kind]}</TD>
                    <TD className="text-xs text-muted">
                      {r.params.ratePercent != null ? `${r.params.ratePercent}%` : r.params.brackets?.length ? `${r.params.brackets.length} escalões` : "Por definir"}
                    </TD>
                    <TD className="text-muted">desde {formatDate(r.effectiveFrom, tz)}</TD>
                    <TD>{r.companyId ? <Badge tone="primary">Empresa</Badge> : <Badge>Plataforma</Badge>}</TD>
                    <TD>
                      {r.validated ? (
                        <span className="text-xs">
                          <Badge tone="success">Validada</Badge>
                          <span className="mt-1 block text-muted">{r.validatedBy}</span>
                        </span>
                      ) : (
                        <Badge tone="warning">Não validada</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </section>
      </PageBody>
    </>
  );
}
