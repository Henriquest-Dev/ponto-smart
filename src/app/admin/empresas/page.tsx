import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { subscriptionPlans } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { pendingRequests, platformOverview } from "@/lib/queries/platform";
import { ApproveRequest } from "@/components/admin-requests";
import { SectionTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { issueInvoiceAction, rejectRequestAction, setCompanyStatusAction } from "../actions";
import { COMPANY_STATUS, SUB_STATUS } from "../labels";
import { ChangePlan, NewCompany } from "./forms";

export const metadata: Metadata = { title: "Empresas" };

export default async function CompaniesPage() {
  await requireContext("platform.companies.manage");
  const [o, plans, requests] = await Promise.all([platformOverview(), db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.priceMonthly)), pendingRequests()]);
  const planOptions = plans.map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      <PageHeader title="Empresas" description="Clientes, planos e estado de acesso." actions={<NewCompany plans={planOptions} />} />
      <PageBody>
        {requests.length ? (
          <section>
            <SectionTitle title={`Pedidos de conta (${requests.length})`} description="Recebidos pela página pública. Ao aprovar, são criadas a empresa e as credenciais do proprietário." />
            <div className="grid gap-3 lg:grid-cols-2">
              {requests.map(({ r, plan }) => (
                <div key={r.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{r.companyName}</p>
                      <p className="text-xs text-muted">{r.contactName} · {r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                    </div>
                    <div className="flex gap-1">
                      <ActionButton size="sm" variant="ghost" action={rejectRequestAction.bind(null, r.id)} confirm={`Recusar o pedido de ${r.companyName}?`}>Recusar</ActionButton>
                      <ApproveRequest requestId={r.id} company={r.companyName} email={r.email} planId={r.planId} plans={planOptions} />
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {[r.city, r.nuit ? `NUIT ${r.nuit}` : null, r.employeesEstimate ? `${r.employeesEstimate} colaboradores` : null, plan ? `Plano ${plan}` : null].filter(Boolean).join(" · ")}
                  </p>
                  {r.message ? <p className="mt-2 rounded-md bg-surface px-3 py-2 text-[13px]">{r.message}</p> : null}
                  <p className="mt-2 text-[11px] text-subtle">Recebido {formatDateTime(r.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <TableWrap>
          <Table>
            <THead><tr><TH>Empresa</TH><TH>NUIT</TH><TH>Colaboradores</TH><TH>Subscrição</TH><TH>Desde</TH><TH>Estado</TH><TH className="text-right">Acções</TH></tr></THead>
            <tbody>
              {o.companies.map((c) => (
                <TR key={c.id}>
                  <TD><span className="block font-medium">{c.name}</span><span className="block text-xs text-muted">{c.email ?? "—"}</span></TD>
                  <TD className="text-muted tabular">{c.nuit ?? "—"}</TD>
                  <TD className="tabular">
                    {c.employees}
                    {c.subscription && c.employees > c.subscription.plan.maxEmployees ? <Badge tone="warning" className="ml-2">Acima do limite</Badge> : null}
                  </TD>
                  <TD>
                    {c.subscription ? (
                      <span className="flex items-center gap-2">
                        <span>{c.subscription.plan.name}</span>
                        <Badge tone={SUB_STATUS[c.subscription.s.status].tone}>{SUB_STATUS[c.subscription.s.status].label}</Badge>
                      </span>
                    ) : "—"}
                  </TD>
                  <TD className="text-muted">{formatDate(c.createdAt)}</TD>
                  <TD><Badge tone={COMPANY_STATUS[c.status].tone}>{COMPANY_STATUS[c.status].label}</Badge></TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      {c.subscription ? <ChangePlan subscriptionId={c.subscription.s.id} planId={c.subscription.s.planId} status={c.subscription.s.status} plans={planOptions} /> : null}
                      {c.subscription ? <ActionButton size="sm" variant="ghost" action={issueInvoiceAction.bind(null, c.subscription.s.id)}>Facturar</ActionButton> : null}
                      {c.status === "suspended" ? (
                        <ActionButton size="sm" variant="ghost" action={setCompanyStatusAction.bind(null, c.id, "active")}>Reactivar</ActionButton>
                      ) : (
                        <ActionButton size="sm" variant="ghost" className="text-danger" action={setCompanyStatusAction.bind(null, c.id, "suspended")} confirm={`Suspender ${c.name}? Os utilizadores perdem o acesso.`}>Suspender</ActionButton>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </PageBody>
    </>
  );
}
