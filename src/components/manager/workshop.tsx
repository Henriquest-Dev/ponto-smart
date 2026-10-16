"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { DescriptionList, EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { renderVehicleReport, type Vehicle, type VehicleVisit } from "@/lib/domain/vehicle-pdf";
import { downloadBlob } from "@/lib/excel";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { attempt } from "@/lib/result";
import { errorMessage, rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";
import { loadStock, type StockItem } from "./stock";

type Found = {
  id: string;
  plate: string;
  name: string;
  ownerName: string;
  ownerPhone: string | null;
  color: string | null;
  createdAt: string;
  visits: number;
  lastVisit: string | null;
  open: boolean;
};

/** Trabalhos mais comuns numa oficina e estética automóvel (pode escrever outros). */
export const SERVICES = [
  "Lavagem",
  "Polimento",
  "Pintura",
  "Bate-chapa",
  "Pneus",
  "Mecânica",
  "Electricidade",
  "Óleo e filtros",
  "Travões",
  "Suspensão",
  "Ar condicionado",
  "Vidros",
  "Estofos",
  "Diagnóstico",
];

/** Matrícula com o aspecto de uma chapa. */
export function Plate({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md border-[1.5px] border-foreground bg-[#ffd633] px-2 font-mono text-[13px] font-bold tracking-wider text-[#1a1530]",
        className,
      )}
    >
      {value}
    </span>
  );
}

/** Procurar viaturas (matrícula, modelo, proprietário) e registar novas. */
export function WorkshopPage({ base }: { base: "/app" | "/empresa" }) {
  const { companyId } = useCompany();
  const initial = useQueryParam("q") ?? "";
  const [q, setQ] = React.useState(initial);
  const [term, setTerm] = React.useState(initial.trim());
  React.useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  const found = useData(() => rpc<Found[]>("ps_vehicle_search", { p_company: companyId, p_q: term || null }), [companyId, term]);
  const inShop = (found.data ?? []).filter((v) => v.open);

  return (
    <>
      <PageHeader
        title="Oficina"
        description="Procure a viatura pela matrícula, pelo modelo ou pelo proprietário. Tudo o que foi feito fica guardado."
        actions={<RegisterDialog base={base} initialPlate={/\d/.test(term) ? term : ""} />}
      />
      <PageBody>
        <label className="relative block max-w-2xl">
          <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Matrícula, modelo ou proprietário (ex.: AAA 123 MC, Nissan)"
            aria-label="Procurar viatura"
            className="h-13 w-full rounded-xl border border-border-strong bg-background pr-4 pl-12 text-[16px] outline-none placeholder:text-subtle focus:border-primary focus:ring-3 focus:ring-primary/15"
          />
        </label>

        {found.error ? <ErrorBlock message={found.error} /> : null}
        {!found.data && !found.error ? <LoadingBlock rows={4} /> : null}
        {found.data ? (
          found.data.length ? (
            <section className="space-y-2">
              <p className="text-[13px] text-muted">
                {term ? `${found.data.length} ${found.data.length === 1 ? "viatura encontrada" : "viaturas encontradas"}` : "Viaturas mais recentes"}
                {!term && inShop.length ? ` · ${inShop.length} na oficina agora` : ""}
              </p>
              <Card>
                <ul className="divide-y divide-border">
                  {found.data.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`${base}/oficina/viatura/?id=${v.id}`}
                        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface sm:gap-4 sm:px-6"
                      >
                        <Plate value={v.plate} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-bold">{v.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {v.ownerName}
                            {v.ownerPhone ? ` · ${v.ownerPhone}` : ""}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-right text-[12.5px] text-muted sm:block">
                          {v.visits} {v.visits === 1 ? "entrada" : "entradas"}
                          {v.lastVisit ? <span className="block">última a {formatDate(v.lastVisit)}</span> : null}
                        </span>
                        {v.open ? <Badge tone="primary">Na oficina</Badge> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : term ? (
            <EmptyState
              title={`Nenhuma viatura com "${term}"`}
              description="Se é a primeira vez que esta viatura vem à oficina, registe-a: o dia e a hora de entrada ficam gravados."
              action={<RegisterDialog base={base} initialPlate={term} />}
            />
          ) : (
            <EmptyState
              title="Ainda sem viaturas"
              description="Registe a primeira viatura com a matrícula, o modelo e o proprietário. Quando voltar, basta procurar a matrícula."
              action={<RegisterDialog base={base} initialPlate="" />}
            />
          )
        ) : null}
      </PageBody>
    </>
  );
}

function RegisterDialog({ base, initialPlate }: { base: string; initialPlate: string }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registar viatura</Button>
      </DialogTrigger>
      <DialogContent title="Registar viatura" description="O dia e a hora de entrada na oficina ficam gravados automaticamente.">
        <ActionForm
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const g = (k: string) => String(fd.get(k) ?? "").trim();
              const r = await rpc<{ id: string; existed: boolean }>("ps_vehicle_register", {
                p_company: companyId,
                p: { plate: g("plate"), name: g("name"), ownerName: g("ownerName"), ownerPhone: g("ownerPhone"), color: g("color") },
              });
              router.push(`${base}/oficina/viatura/?id=${r.id}`);
              return r.existed ? "Esta matrícula já está registada: abrimos a ficha da viatura." : "Viatura registada e entrada aberta.";
            })
          }
        >
          <Field label="Matrícula">
            <Input name="plate" required defaultValue={initialPlate.toUpperCase()} autoCapitalize="characters" placeholder="Ex.: AAA 123 MC" className="font-mono uppercase placeholder:normal-case" />
          </Field>
          <Field label="Viatura (marca e modelo)"><Input name="name" required placeholder="Ex.: Nissan Hardbody" /></Field>
          <Field label="Proprietário"><Input name="ownerName" required placeholder="Nome do cliente" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone (opcional)"><Input name="ownerPhone" inputMode="tel" placeholder="84 000 0000" /></Field>
            <Field label="Cor (opcional)"><Input name="color" placeholder="Ex.: Branco" /></Field>
          </div>
          <SubmitButton className="w-full">Registar e abrir entrada</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Ficha da viatura: dados, cada entrada na oficina com o que foi feito, e o relatório em PDF. */
export function VehiclePage({ base }: { base: "/app" | "/empresa" }) {
  const id = useQueryParam("id");
  const data = useData(() => (id ? rpc<Vehicle>("ps_vehicle_get", { p_vehicle: id }) : Promise.reject(new Error("Viatura não indicada."))), [id]);
  const v = data.data;
  const open = v?.visits.find((x) => x.status === "aberta");

  return (
    <>
      <PageHeader
        title={v ? `${v.plate} · ${v.name}` : "Viatura"}
        description={v ? `${v.ownerName}${v.ownerPhone ? ` · ${v.ownerPhone}` : ""}` : undefined}
        actions={
          v ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/oficina/`}>Procurar outra</Link>
              </Button>
              <ReportDialog vehicle={v} />
              {!open ? (
                <ActionButton
                  action={() =>
                    attempt(async () => {
                      await rpc("ps_visit_open", { p_vehicle: v.id });
                      data.reload();
                      return "Nova entrada aberta com o dia e a hora de agora.";
                    })
                  }
                >
                  Nova entrada
                </ActionButton>
              ) : null}
            </>
          ) : null
        }
      />
      <PageBody>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!v && !data.error ? <LoadingBlock rows={4} /> : null}
        {v ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <section className="min-w-0 space-y-4">
              {v.visits.map((vis, i) => (
                <VisitCard key={vis.id} visit={vis} number={v.visits.length - i} plate={v.plate} reload={data.reload} />
              ))}
              {!v.visits.length ? (
                <EmptyState title="Sem entradas" description="Abra uma entrada quando a viatura chegar à oficina." />
              ) : null}
            </section>
            <aside className="order-first space-y-4 lg:sticky lg:top-4 lg:order-none">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Plate value={v.plate} /> <span className="truncate">{v.name}</span></CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DescriptionList
                    className="sm:grid-cols-1"
                    items={[
                      ["Proprietário", v.ownerName],
                      ["Telefone", v.ownerPhone ?? "—"],
                      ["Cor", v.color ?? "—"],
                      ["Registada a", `${formatDateTime(v.createdAt)}${v.createdBy ? ` por ${v.createdBy}` : ""}`],
                      ["Entradas", String(v.visits.length)],
                    ]}
                  />
                  {v.notes ? <p className="rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed">{v.notes}</p> : null}
                  <VehicleEditDialog vehicle={v} onDone={data.reload} />
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}

function VisitCard({ visit: x, number, plate, reload }: { visit: VehicleVisit; number: number; plate: string; reload: () => void }) {
  const { tz, company } = useCompany();
  const empty = !x.services.length && !x.description && !x.materials.length;
  return (
    <Card className={cn(x.status === "aberta" && "border-primary/50")}>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>
            Entrada {number} · {formatDateTime(x.enteredAt, tz)}
          </CardTitle>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {x.status === "concluida" ? `Concluída${x.finishedAt ? ` a ${formatDateTime(x.finishedAt, tz)}` : ""}` : "Em curso"}
            {x.by ? ` · ${x.by}` : ""}
          </p>
        </div>
        <Badge tone={x.status === "aberta" ? "primary" : "success"}>{x.status === "aberta" ? "Na oficina" : "Concluída"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {x.services.length ? (
          <div className="flex flex-wrap gap-1.5">
            {x.services.map((s) => (
              <span key={s} className="rounded-full bg-primary-soft px-2.5 py-1 text-[12.5px] font-bold text-primary">{s}</span>
            ))}
          </div>
        ) : null}
        {x.description ? <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{x.description}</p> : null}
        {empty ? <p className="text-[13.5px] text-muted">Ainda não registou o que foi feito nesta entrada.</p> : null}
        {x.mileage || x.amount ? (
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            {x.mileage ? <span><span className="text-muted">Quilómetros</span> <b className="tabular">{x.mileage.toLocaleString("pt-PT")} km</b></span> : null}
            {x.amount ? <span><span className="text-muted">Valor</span> <b className="tabular">{formatMoney(x.amount, company.currency)}</b></span> : null}
          </p>
        ) : null}

        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-[13px] font-bold">Materiais do estoque</p>
            <MaterialDialog visit={x} plate={plate} onDone={reload} />
          </div>
          {x.materials.length ? (
            <ul className="divide-y divide-border">
              {x.materials.map((m) => (
                <li key={m.movementId} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <b className="tabular">{Number(m.quantity).toLocaleString("pt-PT")} {m.unit}</b>
                    <ActionButton
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Retirar ${m.name}`}
                      confirm={`Retirar ${m.name} desta entrada? A quantidade volta ao estoque.`}
                      action={() =>
                        attempt(async () => {
                          await rpc("ps_visit_material_remove", { p_movement: m.movementId });
                          reload();
                          return "Material retirado e devolvido ao estoque.";
                        })
                      }
                    >
                      Retirar
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-[12.5px] text-muted">Os materiais usados saem do estoque automaticamente.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <VisitDialog visit={x} onDone={reload} />
          {x.status === "aberta" ? (
            <ActionButton
              variant="outline"
              action={() =>
                attempt(async () => {
                  await rpc("ps_visit_save", {
                    p_visit: x.id,
                    p: { services: x.services, description: x.description ?? "", mileage: x.mileage ?? "", amount: x.amount ?? "", status: "concluida" },
                  });
                  reload();
                  return "Entrada concluída.";
                })
              }
            >
              Concluir
            </ActionButton>
          ) : null}
          <ActionButton
            variant="ghost"
            confirm="Apagar esta entrada? Os materiais voltam ao estoque. Não dá para desfazer."
            action={() =>
              attempt(async () => {
                await rpc("ps_visit_delete", { p_visit: x.id });
                reload();
                return "Entrada apagada.";
              })
            }
          >
            Apagar
          </ActionButton>
        </div>
      </CardContent>
    </Card>
  );
}

function VisitDialog({ visit: x, onDone }: { visit: VehicleVisit; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const extra = x.services.filter((s) => !SERVICES.includes(s));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{x.services.length || x.description ? "Editar trabalho" : "Registar o que foi feito"}</Button>
      </DialogTrigger>
      <DialogContent title="O que foi feito" description={`Entrada de ${formatDateTime(x.enteredAt)}`} wide>
        <ActionForm
          resetOnSuccess={false}
          onSuccess={() => setOpen(false)}
          className="space-y-5"
          action={(_p, fd) =>
            attempt(async () => {
              const services = [
                ...SERVICES.filter((s) => fd.get(`s_${s}`) === "on"),
                ...String(fd.get("other") ?? "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              ];
              const km = String(fd.get("mileage") ?? "").replace(/\D/g, "");
              const amount = String(fd.get("amount") ?? "").replace(/\s/g, "").replace(",", ".");
              if (amount && !Number.isFinite(Number(amount))) throw new Error("Valor inválido.");
              await rpc("ps_visit_save", {
                p_visit: x.id,
                p: { services, description: String(fd.get("description") ?? ""), mileage: km, amount, status: String(fd.get("status") ?? "aberta") },
              });
              onDone();
              return "Trabalho guardado.";
            })
          }
        >
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold">Trabalhos</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SERVICES.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13.5px] has-checked:border-primary has-checked:bg-primary-soft">
                  <Checkbox name={`s_${s}`} defaultChecked={x.services.includes(s)} /> {s}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Outros trabalhos" hint="Separe por vírgulas">
            <Input name="other" defaultValue={extra.join(", ")} placeholder="Ex.: Troca de farol, Película" />
          </Field>
          <Field label="Descrição do que foi feito">
            <Textarea name="description" defaultValue={x.description ?? ""} placeholder="Ex.: Pintura da porta traseira esquerda, polimento geral e troca dos 2 pneus da frente." />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Quilómetros"><Input name="mileage" inputMode="numeric" defaultValue={x.mileage ?? ""} /></Field>
            <Field label="Valor (MZN)"><Input name="amount" inputMode="decimal" defaultValue={x.amount ?? ""} /></Field>
            <Field label="Estado">
              <Select name="status" defaultValue={x.status}>
                <option value="aberta">Na oficina</option>
                <option value="concluida">Concluída</option>
              </Select>
            </Field>
          </div>
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function MaterialDialog({ visit, plate, onDone }: { visit: VehicleVisit; plate: string; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  const items = useData(() => (open ? loadStock(companyId) : Promise.resolve([] as StockItem[])), [open, companyId]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="soft">Adicionar</Button>
      </DialogTrigger>
      <DialogContent title="Material usado" description={`Sai do estoque e fica nesta entrada da viatura ${plate}.`}>
        {items.error ? <ErrorBlock message={items.error} /> : null}
        {items.data && !items.data.length && !items.loading ? (
          <p className="text-[13.5px] text-muted">O estoque está vazio. Adicione materiais na página Estoque.</p>
        ) : (
          <ActionForm
            onSuccess={() => setOpen(false)}
            className="space-y-4"
            action={(_p, fd) =>
              attempt(async () => {
                const item = String(fd.get("item") ?? "");
                const q = Number(String(fd.get("qty") ?? "").replace(",", "."));
                if (!item) throw new Error("Escolha o material.");
                if (!Number.isFinite(q) || q <= 0) throw new Error("Indique a quantidade.");
                await rpc("ps_visit_material_add", { p_visit: visit.id, p_item: item, p_qty: q });
                onDone();
                return "Material registado e retirado do estoque.";
              })
            }
          >
            <Field label="Material">
              <Select name="item" required defaultValue="">
                <option value="" disabled>Escolher…</option>
                {(items.data ?? []).map((i) => (
                  <option key={i.id} value={i.id} disabled={i.quantity <= 0}>
                    {i.name} ({Number(i.quantity).toLocaleString("pt-PT")} {i.unit})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantidade"><Input name="qty" inputMode="decimal" required defaultValue="1" /></Field>
            <SubmitButton className="w-full">Registar</SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehicleEditDialog({ vehicle: v, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">Editar dados da viatura</Button>
      </DialogTrigger>
      <DialogContent title="Dados da viatura">
        <ActionForm
          resetOnSuccess={false}
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const g = (k: string) => String(fd.get(k) ?? "").trim();
              await rpc("ps_vehicle_update", {
                p_vehicle: v.id,
                p: { plate: g("plate"), name: g("name"), ownerName: g("ownerName"), ownerPhone: g("ownerPhone"), color: g("color"), notes: g("notes") },
              });
              onDone();
              return "Dados guardados.";
            })
          }
        >
          <Field label="Matrícula"><Input name="plate" required defaultValue={v.plate} className="font-mono uppercase" /></Field>
          <Field label="Viatura (marca e modelo)"><Input name="name" required defaultValue={v.name} /></Field>
          <Field label="Proprietário"><Input name="ownerName" required defaultValue={v.ownerName} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone"><Input name="ownerPhone" defaultValue={v.ownerPhone ?? ""} /></Field>
            <Field label="Cor"><Input name="color" defaultValue={v.color ?? ""} /></Field>
          </div>
          <Field label="Notas"><Textarea name="notes" defaultValue={v.notes ?? ""} className="min-h-16" /></Field>
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Personalizar e descarregar o relatório da viatura em PDF. */
function ReportDialog({ vehicle: v }: { vehicle: Vehicle }) {
  const { company, me, tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [chosen, setChosen] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (open) setChosen(v.visits.map((x) => x.id));
  }, [open, v.visits]);

  const make = async (fd: FormData) => {
    if (!chosen.length) {
      toast.error("Escolha pelo menos uma entrada.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await renderVehicleReport(
        v,
        {
          title: String(fd.get("title") ?? "").trim() || "Relatório da viatura",
          visitIds: chosen,
          owner: fd.get("owner") === "on",
          materials: fd.get("materials") === "on",
          amounts: fd.get("amounts") === "on",
          mileage: fd.get("mileage") === "on",
          note: String(fd.get("note") ?? ""),
        },
        { company: company.companyName, currency: company.currency, tz, author: me.name },
      );
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `relatorio-${v.plate.replace(/\W+/g, "")}.pdf`);
      toast.success("Relatório descarregado.");
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Relatório PDF</Button>
      </DialogTrigger>
      <DialogContent title="Relatório em PDF" description="Escolha o que entra no relatório. Para mudar os dados, edite a entrada e volte a exportar." wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void make(new FormData(e.currentTarget));
          }}
        >
          <Field label="Título"><Input name="title" defaultValue="Relatório da viatura" /></Field>
          <fieldset>
            <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-bold">
              Entradas
              <span className="flex gap-3 text-[12.5px] font-bold">
                <button type="button" className="text-primary" onClick={() => setChosen(v.visits.map((x) => x.id))}>Todas</button>
                <button type="button" className="text-primary" onClick={() => setChosen(v.visits.slice(0, 1).map((x) => x.id))}>Só a última</button>
              </span>
            </legend>
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {v.visits.map((x) => (
                <li key={x.id}>
                  <label className="flex items-center gap-3 px-3 py-2 text-[13.5px]">
                    <Checkbox
                      checked={chosen.includes(x.id)}
                      onChange={(e) => setChosen((c) => (e.target.checked ? [...c, x.id] : c.filter((i) => i !== x.id)))}
                    />
                    <span className="min-w-0 flex-1">
                      <b>{formatDateTime(x.enteredAt, tz)}</b>
                      <span className="block truncate text-[12.5px] text-muted">{x.services.join(", ") || x.description || "Sem trabalhos registados"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-bold">Incluir</legend>
            <label className="flex items-center gap-2 text-[13.5px]"><Checkbox name="owner" defaultChecked /> Contacto do proprietário</label>
            <label className="flex items-center gap-2 text-[13.5px]"><Checkbox name="materials" defaultChecked /> Materiais usados</label>
            <label className="flex items-center gap-2 text-[13.5px]"><Checkbox name="amounts" defaultChecked /> Valores</label>
            <label className="flex items-center gap-2 text-[13.5px]"><Checkbox name="mileage" defaultChecked /> Quilómetros</label>
          </fieldset>
          <Field label="Observações (opcional)">
            <Textarea name="note" className="min-h-16" placeholder="Ex.: Garantia de 3 meses na pintura. Próxima revisão aos 60 000 km." />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            Descarregar PDF
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
