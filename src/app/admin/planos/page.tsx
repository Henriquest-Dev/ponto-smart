"use client";

import { Layers, Pencil, Plus } from "lucide-react";
import * as React from "react";
import { billable, loadOverview, type Plan } from "@/components/admin/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PendingButton, SubmitForm } from "@/components/admin/submit-form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatMoney } from "@/lib/format";
import { attempt, formObject } from "@/lib/result";
import { must, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";

export default function PlansPage() {
  const { data, error, loading, reload } = useData(loadOverview, []);
  const [editing, setEditing] = React.useState<Plan | "new" | null>(null);

  const plans = data?.plans ?? [];
  const usage = (code: string) => (data?.companies ?? []).filter((c) => c.plan_code === code && billable(c));

  return (
    <>
      <PageHeader
        title="Planos"
        description="Preços mensais, limites e módulos incluídos. Os planos activos aparecem na página pública de pedido de conta."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Novo plano
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {loading && !data ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <EmptyState icon={<Layers />} title="Sem planos" description="Crie o primeiro plano de subscrição." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => {
              const used = usage(p.code);
              const revenue = used.reduce((s, c) => s + Number(c.price_monthly ?? 0), 0);
              return (
                <Card key={p.id} className={p.active ? "flex flex-col p-5" : "flex flex-col p-5 opacity-70"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[15px] font-semibold">
                        {p.name}
                        {p.active ? null : <Badge>Inactivo</Badge>}
                      </p>
                      <p className="font-mono text-xs text-muted">{p.code}</p>
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil />
                    </Button>
                  </div>
                  <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">
                    {formatMoney(p.price_monthly, p.currency)}
                    <span className="text-sm font-normal text-muted"> /mês</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    Até {p.max_employees} colaboradores · {used.length} {used.length === 1 ? "empresa" : "empresas"}
                    {used.length ? ` · ${formatMoney(revenue, p.currency)}/mês` : ""}
                  </p>
                  {p.modules.length ? (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {p.modules.map((m) => (
                        <Badge key={m}>{m}</Badge>
                      ))}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>

      <PlanDialog
        plan={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </>
  );
}

function PlanDialog({ plan, open, onClose, onSaved }: { plan: Plan | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open ? (
        <DialogContent title={plan ? `Editar plano — ${plan.name}` : "Novo plano"}>
          <SubmitForm
            key={plan?.id ?? "new"}
            onSubmit={(fd) =>
              attempt(async () => {
                const o = formObject(fd);
                const code = (o.code ?? "").toLowerCase();
                if (!/^[a-z0-9_-]{2,30}$/.test(code)) throw new Error("Código inválido: 2 a 30 letras minúsculas, números, - ou _.");
                if (!o.name || o.name.length < 2) throw new Error("Indique o nome do plano.");
                const price = Number((o.price_monthly ?? "").replace(/\s/g, "").replace(",", "."));
                if (!Number.isFinite(price) || price < 0) throw new Error("Preço inválido.");
                const max = Number(o.max_employees);
                if (!Number.isInteger(max) || max < 1) throw new Error("Indique o número máximo de colaboradores.");
                const values = {
                  code,
                  name: o.name,
                  price_monthly: Math.round(price * 100) / 100,
                  currency: o.currency ?? "MZN",
                  max_employees: max,
                  modules: (o.modules ?? "")
                    .split(/[,\n]/)
                    .map((m) => m.trim())
                    .filter(Boolean),
                  active: fd.get("active") === "on",
                };
                if (plan) must(await sb().from("subscription_plans").update(values).eq("id", plan.id).select("id").single());
                else must(await sb().from("subscription_plans").insert(values).select("id").single());
                return plan ? "Plano actualizado." : "Plano criado.";
              })
            }
            onSuccess={() => {
              onClose();
              onSaved();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label="Nome">
              <Input name="name" defaultValue={plan?.name} required />
            </Field>
            <Field label="Código" hint={plan ? "Usado nas ligações ?plano= e nos pedidos." : "Ex.: essencial, pro"}>
              <Input name="code" defaultValue={plan?.code} required pattern="[a-z0-9_\-]{2,30}" autoCapitalize="none" spellCheck={false} className="font-mono" />
            </Field>
            <Field label="Preço mensal">
              <Input name="price_monthly" defaultValue={plan ? String(Number(plan.price_monthly)) : ""} inputMode="decimal" required />
            </Field>
            <Field label="Moeda">
              <Select name="currency" defaultValue={plan?.currency ?? "MZN"}>
                <option value="MZN">MZN</option>
                <option value="USD">USD</option>
                <option value="ZAR">ZAR</option>
              </Select>
            </Field>
            <Field label="Máx. colaboradores">
              <Input name="max_employees" type="number" min={1} defaultValue={plan?.max_employees} required />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2.5 text-[13px] font-medium">
              <Checkbox name="active" defaultChecked={plan ? plan.active : true} /> Plano activo (disponível para novos pedidos)
            </label>
            <Field label="Módulos" hint="Separados por vírgula (ex.: ponto, assiduidade, salarios)." className="sm:col-span-2">
              <Input name="modules" defaultValue={plan?.modules.join(", ")} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <PendingButton pendingText="A guardar…">Guardar</PendingButton>
            </div>
          </SubmitForm>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
