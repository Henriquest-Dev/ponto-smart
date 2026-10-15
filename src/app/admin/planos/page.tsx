"use client";

import * as React from "react";
import { billable, loadOverview, type Plan } from "@/components/admin/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PendingButton, SubmitForm } from "@/components/admin/submit-form";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
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
            Novo plano
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {loading && !data ? (
          <Skeleton className="h-72 rounded-[22px]" />
        ) : plans.length === 0 ? (
          <EmptyState
            title="Sem planos"
            description="Crie o primeiro plano de subscrição."
            action={<Button onClick={() => setEditing("new")}>Novo plano</Button>}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[22px] border border-border">
            {plans.map((p) => {
              const used = usage(p.code);
              const revenue = used.reduce((s, c) => s + Number(c.price_monthly ?? 0), 0);
              return (
                <li
                  key={p.id}
                  className={cn(
                    "grid gap-4 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center",
                    !p.active && "bg-surface/60",
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[18px] font-extrabold tracking-[-0.01em]">{p.name}</span>
                      {p.active ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-muted">{p.code}</p>
                    {p.modules.length ? <p className="mt-2 text-[13px] text-muted">{p.modules.join(", ")}</p> : null}
                  </div>
                  <div>
                    <p className="text-[26px] leading-none font-extrabold tracking-[-0.02em] tabular">{formatMoney(p.price_monthly, p.currency)}</p>
                    <p className="mt-1.5 text-[13px] text-muted">por mês, até {formatNumber(p.max_employees)} colaboradores</p>
                  </div>
                  <div>
                    <p className="text-[15px] font-extrabold tabular">
                      {used.length} {used.length === 1 ? "empresa" : "empresas"}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted tabular">
                      {used.length ? `${formatMoney(revenue, p.currency)} por mês` : "Sem receita"}
                    </p>
                  </div>
                  <div>
                    <Button size="sm" variant="outline" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
                      Editar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
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
        <DialogContent title={plan ? `Editar o plano ${plan.name}` : "Novo plano"}>
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
            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-[13.5px] font-bold">
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
