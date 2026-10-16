"use client";

import { MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
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
import { Tabs } from "@/components/ui/tabs";
import type { Vehicle, VehicleVisit } from "@/lib/domain/vehicle-pdf";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { attempt } from "@/lib/result";
import { errorMessage, rpc } from "@/lib/sb/client";
import { useCompany, useSession } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { localDateTimeInput } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CustomFieldInputs, FieldsEditor, filledPairs, readExtra, useCustomFields, type CustomField, type Extra } from "./custom-fields";
import { PhotoPicker, uploadVehiclePhoto, VehicleAvatar, VehicleGallery } from "./photos";
import { ReportEditor } from "./report-editor";
import { loadStock, type StockItem } from "./stock";
import { WorkshopMonth } from "./workshop-month";

type Found = {
  id: string;
  plate: string;
  name: string;
  ownerName: string;
  ownerPhone: string | null;
  color: string | null;
  createdAt: string;
  cover?: string | null;
  visits: number;
  lastVisit: string | null;
  open: boolean;
};

/** Trabalhos de uma oficina e estética automóvel, para começar (a lista é editável em Personalizar). */
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

export function useServices() {
  const { company } = useCompany();
  return company.settings?.workshopServices?.length ? company.settings.workshopServices : SERVICES;
}

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

/** Oficina: procurar e registar viaturas, e o resumo do mês. */
export function WorkshopPage({ base }: { base: "/app" | "/empresa" }) {
  const initialTab = useQueryParam("tab") === "mes" ? "mes" : "viaturas";
  const [tab, setTab] = React.useState<"viaturas" | "mes">(initialTab);
  const vehicleFields = useCustomFields("vehicle");
  return (
    <>
      <PageHeader
        title="Oficina"
        description="Procure pela matrícula, pelo modelo ou pelo proprietário. Tudo o que foi feito fica guardado."
        actions={
          <>
            <CustomizeDialog onChange={vehicleFields.reload} />
            <RegisterDialog base={base} initialPlate="" fields={vehicleFields.data ?? []} />
          </>
        }
      />
      <PageBody>
        <Tabs
          items={[
            { key: "viaturas", label: "Viaturas" },
            { key: "mes", label: "Resumo do mês" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === "viaturas" ? <SearchVehicles base={base} fields={vehicleFields.data ?? []} /> : <WorkshopMonth base={base} />}
      </PageBody>
    </>
  );
}

function SearchVehicles({ base, fields }: { base: string; fields: CustomField[] }) {
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
    <div className="space-y-4">
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
                    <Link href={`${base}/oficina/viatura/?id=${v.id}`} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface sm:gap-4 sm:px-5">
                      <VehicleAvatar photoKey={v.cover} plate={v.plate} className="size-16 sm:size-[72px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Plate value={v.plate} className="h-6 text-[12px]" />
                          {v.open ? <Badge tone="primary">Na oficina</Badge> : null}
                        </span>
                        <span className="mt-1 block truncate text-[14.5px] font-bold">{v.name}</span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {v.ownerName}
                          {v.ownerPhone ? ` · ${v.ownerPhone}` : ""}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-right text-[12.5px] text-muted sm:block">
                        {v.visits} {v.visits === 1 ? "entrada" : "entradas"}
                        {v.lastVisit ? <span className="block">última a {formatDate(v.lastVisit)}</span> : null}
                      </span>
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
            action={<RegisterDialog base={base} initialPlate={term} fields={fields} />}
          />
        ) : (
          <EmptyState
            title="Ainda sem viaturas"
            description="Registe a primeira viatura com a matrícula, o modelo, o proprietário e uma foto. Quando voltar, basta procurar a matrícula."
            action={<RegisterDialog base={base} initialPlate="" fields={fields} />}
          />
        )
      ) : null}
    </div>
  );
}

/** Personalizar a Oficina: campos da viatura, campos de cada entrada e lista de trabalhos. */
function CustomizeDialog({ onChange }: { onChange?: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal className="size-4" aria-hidden /> Personalizar
        </Button>
      </DialogTrigger>
      <DialogContent title="Personalizar a Oficina" description="Crie os campos de que precisa. Aparecem nos formulários, na ficha, na planilha do mês e no PDF." wide>
        <div className="space-y-7">
          <FieldsEditor entity="vehicle" title="Campos da viatura" onChange={onChange} />
          <FieldsEditor entity="visit" title="Campos de cada entrada na oficina" />
          <ServicesEditor />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ServicesEditor() {
  const { companyId } = useCompany();
  const { refresh } = useSession();
  const services = useServices();
  const [list, setList] = React.useState(services);
  const [add, setAdd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const changed = list.join("|") !== services.join("|");
  const save = async () => {
    setBusy(true);
    try {
      await rpc("ps_workshop_services_set", { p_company: companyId, p_services: list });
      await refresh();
      toast.success("Lista de trabalhos guardada.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <p className="text-[14px] font-bold">Lista de trabalhos</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-2.5 text-[12.5px] font-bold text-primary">
            {s}
            <button type="button" aria-label={`Retirar ${s}`} className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15" onClick={() => setList((l) => l.filter((x) => x !== s))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = add.trim();
          if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) setList((l) => [...l, t]);
          setAdd("");
        }}
      >
        <Input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Novo trabalho (ex.: Película)" aria-label="Novo trabalho" />
        <Button type="submit" variant="soft">Juntar</Button>
      </form>
      {changed ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()} disabled={busy}>Guardar lista</Button>
          <Button size="sm" variant="ghost" onClick={() => setList(services)}>Desfazer</Button>
        </div>
      ) : null}
    </section>
  );
}

function RegisterDialog({ base, initialPlate, fields }: { base: string; initialPlate: string; fields: CustomField[] }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [photos, setPhotos] = React.useState<File[]>([]);
  React.useEffect(() => {
    if (!open) setPhotos([]);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registar viatura</Button>
      </DialogTrigger>
      <DialogContent title="Registar viatura" description="O dia e a hora de entrada na oficina ficam gravados automaticamente." wide>
        <ActionForm
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const g = (k: string) => String(fd.get(k) ?? "").trim();
              const r = await rpc<{ id: string; existed: boolean }>("ps_vehicle_register", {
                p_company: companyId,
                p: { plate: g("plate"), name: g("name"), ownerName: g("ownerName"), ownerPhone: g("ownerPhone"), color: g("color"), extra: readExtra(fd, fields) },
              });
              let failed = 0;
              if (!r.existed) for (const f of photos) await uploadVehiclePhoto(companyId, r.id, f).catch(() => failed++);
              router.push(`${base}/oficina/viatura/?id=${r.id}`);
              if (r.existed) return "Esta matrícula já está registada: abrimos a ficha da viatura.";
              return failed ? `Viatura registada, mas ${failed} foto(s) não foram enviadas. Tente de novo na ficha.` : "Viatura registada e entrada aberta.";
            })
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Matrícula">
              <Input name="plate" required defaultValue={initialPlate.toUpperCase()} autoCapitalize="characters" placeholder="Ex.: AAA 123 MC" className="font-mono uppercase placeholder:normal-case" />
            </Field>
            <Field label="Viatura (marca e modelo)"><Input name="name" required placeholder="Ex.: Nissan Hardbody" /></Field>
            <Field label="Proprietário"><Input name="ownerName" required placeholder="Nome do cliente" /></Field>
            <Field label="Telefone (opcional)"><Input name="ownerPhone" inputMode="tel" placeholder="84 000 0000" /></Field>
            <Field label="Cor (opcional)"><Input name="color" placeholder="Ex.: Branco" /></Field>
          </div>
          <CustomFieldInputs fields={fields} />
          <div className="rounded-xl border border-dashed border-border-strong p-3">
            <p className="text-[13px] font-bold">Fotos da viatura</p>
            <p className="mb-2 text-[12.5px] text-muted">A primeira fica como foto de perfil e aparece quando se procura a matrícula.</p>
            {photos.length ? (
              <ul className="mb-2 flex flex-wrap gap-2">
                {photos.map((f, i) => (
                  <li key={i} className="relative">
                    <PreviewThumb file={f} />
                    <button type="button" aria-label="Retirar foto" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-[13px] text-white">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <PhotoPicker compact onFiles={(f) => setPhotos((p) => [...p, ...f].slice(0, 10))} />
          </div>
          <SubmitButton className="w-full">Registar e abrir entrada</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function PreviewThumb({ file }: { file: File }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="size-16 rounded-lg object-cover" /> : null;
}

/** Ficha da viatura: foto, dados, cada entrada na oficina com o que foi feito, e o relatório em PDF. */
export function VehiclePage({ base }: { base: "/app" | "/empresa" }) {
  const id = useQueryParam("id");
  const { companyId, company } = useCompany();
  const data = useData(() => (id ? rpc<Vehicle>("ps_vehicle_get", { p_vehicle: id }) : Promise.reject(new Error("Viatura não indicada."))), [id]);
  const vehicleFields = useCustomFields("vehicle");
  const visitFields = useCustomFields("visit");
  const v = data.data;
  const open = v?.visits.find((x) => x.status === "aberta");
  const cover = v?.photos?.find((p) => p.id === v.coverId);
  const vf = vehicleFields.data ?? [];

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
              <ReportEditor vehicle={v} vehicleFields={vf} visitFields={visitFields.data ?? []} />
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
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <section className="min-w-0 space-y-4">
              {v.visits.map((vis, i) => (
                <VisitCard key={vis.id} visit={vis} number={v.visits.length - i} plate={v.plate} fields={visitFields.data ?? []} reload={data.reload} />
              ))}
              {!v.visits.length ? <EmptyState title="Sem entradas" description="Abra uma entrada quando a viatura chegar à oficina." /> : null}
            </section>
            <aside className="order-first space-y-4 lg:sticky lg:top-4 lg:order-none">
              <Card className="overflow-hidden">
                <VehicleAvatar photoKey={cover?.key} plate={v.plate} className="aspect-[4/3] w-full rounded-none" />
                <CardContent className="space-y-4 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Plate value={v.plate} />
                    <CardTitle className="truncate">{v.name}</CardTitle>
                  </div>
                  <DescriptionList
                    className="sm:grid-cols-1"
                    items={[
                      ["Proprietário", v.ownerName],
                      ["Telefone", v.ownerPhone ?? "—"],
                      ["Cor", v.color ?? "—"],
                      ...filledPairs(vf, v.extra as Extra, company.currency),
                      ["Registada a", `${formatDateTime(v.createdAt)}${v.createdBy ? ` por ${v.createdBy}` : ""}`],
                      ["Entradas", String(v.visits.length)],
                    ]}
                  />
                  {v.notes ? <p className="rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed">{v.notes}</p> : null}
                  <VehicleEditDialog vehicle={v} fields={vf} onDone={data.reload} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Fotos</CardTitle>
                </CardHeader>
                <CardContent>
                  <VehicleGallery companyId={companyId} vehicleId={v.id} plate={v.plate} photos={v.photos ?? []} coverId={v.coverId ?? null} onChange={data.reload} />
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}

function VisitCard({ visit: x, number, plate, fields, reload }: { visit: VehicleVisit; number: number; plate: string; fields: CustomField[]; reload: () => void }) {
  const { tz, company } = useCompany();
  const extras = filledPairs(fields, x.extra as Extra, company.currency);
  const empty = !x.services.length && !x.description && !x.materials.length && !extras.length;
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
        {x.mileage || x.amount || extras.length ? (
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            {x.mileage ? <Pair k="Quilómetros" v={`${x.mileage.toLocaleString("pt-PT")} km`} /> : null}
            {x.amount ? <Pair k="Valor" v={formatMoney(x.amount, company.currency)} /> : null}
            {extras.map(([k, v]) => (
              <Pair key={k} k={k} v={v} />
            ))}
          </dl>
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
          <VisitDialog visit={x} fields={fields} onDone={reload} />
          {x.status === "aberta" ? (
            <ActionButton
              variant="outline"
              action={() =>
                attempt(async () => {
                  await rpc("ps_visit_save", { p_visit: x.id, p: { status: "concluida" } });
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

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{k}</dt>
      <dd className="font-bold break-words">{v}</dd>
    </div>
  );
}

function VisitDialog({ visit: x, fields, onDone }: { visit: VehicleVisit; fields: CustomField[]; onDone: () => void }) {
  const { tz } = useCompany();
  const services = useServices();
  const [open, setOpen] = React.useState(false);
  const extra = x.services.filter((s) => !services.includes(s));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{x.services.length || x.description ? "Editar trabalho" : "Registar o que foi feito"}</Button>
      </DialogTrigger>
      <DialogContent title="O que foi feito" description={`Entrada de ${formatDateTime(x.enteredAt, tz)}`} wide>
        <ActionForm
          resetOnSuccess={false}
          onSuccess={() => setOpen(false)}
          className="space-y-5"
          action={(_p, fd) =>
            attempt(async () => {
              const list = [
                ...services.filter((s) => fd.get(`s_${s}`) === "on"),
                ...String(fd.get("other") ?? "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              ];
              const amount = String(fd.get("amount") ?? "").replace(/\s/g, "").replace(",", ".");
              if (amount && !Number.isFinite(Number(amount))) throw new Error("Valor inválido.");
              await rpc("ps_visit_save", {
                p_visit: x.id,
                p: {
                  services: list,
                  description: String(fd.get("description") ?? ""),
                  mileage: String(fd.get("mileage") ?? ""),
                  amount,
                  status: String(fd.get("status") ?? "aberta"),
                  enteredAt: String(fd.get("enteredAt") ?? ""),
                  extra: readExtra(fd, fields),
                },
              });
              onDone();
              return "Trabalho guardado.";
            })
          }
        >
          <fieldset>
            <legend className="mb-2 text-[13px] font-bold">Trabalhos</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {services.map((s) => (
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entrada (dia e hora)"><Input type="datetime-local" name="enteredAt" defaultValue={localDateTimeInput(x.enteredAt, tz)} /></Field>
            <Field label="Estado">
              <Select name="status" defaultValue={x.status}>
                <option value="aberta">Na oficina</option>
                <option value="concluida">Concluída</option>
              </Select>
            </Field>
            <Field label="Quilómetros"><Input name="mileage" inputMode="numeric" defaultValue={x.mileage ?? ""} /></Field>
            <Field label="Valor (MZN)"><Input name="amount" inputMode="decimal" defaultValue={x.amount ?? ""} /></Field>
          </div>
          <CustomFieldInputs fields={fields} values={x.extra as Extra} />
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

function VehicleEditDialog({ vehicle: v, fields, onDone }: { vehicle: Vehicle; fields: CustomField[]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">Editar dados da viatura</Button>
      </DialogTrigger>
      <DialogContent title="Dados da viatura" wide>
        <ActionForm
          resetOnSuccess={false}
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const g = (k: string) => String(fd.get(k) ?? "").trim();
              await rpc("ps_vehicle_update", {
                p_vehicle: v.id,
                p: { plate: g("plate"), name: g("name"), ownerName: g("ownerName"), ownerPhone: g("ownerPhone"), color: g("color"), notes: g("notes"), extra: readExtra(fd, fields) },
              });
              onDone();
              return "Dados guardados.";
            })
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Matrícula"><Input name="plate" required defaultValue={v.plate} className="font-mono uppercase" /></Field>
            <Field label="Viatura (marca e modelo)"><Input name="name" required defaultValue={v.name} /></Field>
            <Field label="Proprietário"><Input name="ownerName" required defaultValue={v.ownerName} /></Field>
            <Field label="Telefone"><Input name="ownerPhone" defaultValue={v.ownerPhone ?? ""} /></Field>
            <Field label="Cor"><Input name="color" defaultValue={v.color ?? ""} /></Field>
          </div>
          <CustomFieldInputs fields={fields} values={v.extra as Extra} />
          <Field label="Notas"><Textarea name="notes" defaultValue={v.notes ?? ""} className="min-h-16" /></Field>
          <SubmitButton className="w-full">Guardar</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
