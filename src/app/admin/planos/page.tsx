import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { requireContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { subscriptionPlans, subscriptions } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { PlanEditor } from "./forms";

export const metadata: Metadata = { title: "Planos" };

export default async function PlansPage() {
  await requireContext("platform.plans.manage");
  const [plans, usage] = await Promise.all([
    db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.priceMonthly)),
    db.select({ planId: subscriptions.planId, n: count() }).from(subscriptions).where(eq(subscriptions.status, "active")).groupBy(subscriptions.planId),
  ]);
  return (
    <>
      <PageHeader title="Planos" description="Preços mensais, limites e módulos incluídos." actions={<PlanEditor />} />
      <PageBody>
        <Notice tone="info">Preços de demonstração. Defina a tabela comercial antes do lançamento.</Notice>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <p className="text-[15px] font-semibold">{p.name}</p>
                <PlanEditor plan={{ id: p.id, code: p.code, name: p.name, priceMonthly: p.priceMonthly, maxEmployees: p.maxEmployees, modules: p.modules }} />
              </div>
              <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">{formatMoney(p.priceMonthly, p.currency)}<span className="text-sm font-normal text-muted"> /mês</span></p>
              <p className="text-[13px] text-muted">Até {p.maxEmployees} colaboradores · {usage.find((u) => u.planId === p.id)?.n ?? 0} subscrições activas</p>
              <div className="mt-4 flex flex-wrap gap-1.5">{p.modules.map((m) => <Badge key={m}>{m}</Badge>)}</div>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
