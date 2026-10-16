"use client";

import * as React from "react";
import { ErrorBlock, LoadingBlock } from "@/components/company/p2-shared";
import { ActionButton } from "@/components/ui/action-button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { MonthPicker, currentMonth } from "@/components/ui/month-picker";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { SlidersHorizontal } from "@phosphor-icons/react";
import { buildWorkbook, downloadBlob } from "@/lib/excel";
import { canShareFiles, shareFile } from "@/lib/share";
import { formatDate, formatDateTime, periodLabel } from "@/lib/format";
import { attempt } from "@/lib/result";
import { rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";
import { CustomFieldInputs, FieldsEditor, filledPairs, readExtra, showValue, useCustomFields, type CustomField, type Extra } from "./custom-fields";

export type StockState = "ok" | "a_acabar" | "esgotado";
export type StockItem = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  quantity: number;
  minQuantity: number;
  notes: string | null;
  active: boolean;
  state: StockState;
  lastCountedAt: string | null;
  updatedAt: string;
  extra?: Extra;
};
type Movement = { id: string; kind: "entrada" | "saida" | "contagem"; delta: number; balance: number; note: string | null; at: string; by: string | null; plate: string | null };
type MonthRow = {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  minQuantity: number;
  start: number;
  entradas: number;
  saidas: number;
  acertos: number;
  end: number;
  state: StockState;
  lastCountedAt: string | null;
  extra?: Extra;
};

export const STOCK_STATE: Record<StockState, { label: string; tone: Tone }> = {
  ok: { label: "Em estoque", tone: "success" },
  a_acabar: { label: "Quase a acabar", tone: "warning" },
  esgotado: { label: "Esgotado", tone: "danger" },
};
const UNITS = ["un", "L", "ml", "kg", "g", "m", "rolo", "caixa", "lata", "par", "kit"];
const qty = (n: number) => Number(n).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
const KIND_LABEL: Record<Movement["kind"], string> = { entrada: "Entrada", saida: "Saída", contagem: "Contagem" };

export function loadStock(companyId: string, archived = false) {
  return rpc<StockItem[]>("ps_stock_items", { p_company: companyId, p_archived: archived });
}

/** Página de estoque (gerente no painel pessoal, proprietário e administrador no painel da empresa). */
export function StockPage() {
  const { companyId } = useCompany();
  const [tab, setTab] = React.useState<"materiais" | "mes" | "arquivo">("materiais");
  const items = useData(() => loadStock(companyId), [companyId]);
  const fields = useCustomFields("stock");
  const fl = fields.data ?? [];
  const list = items.data ?? [];
  const low = list.filter((i) => i.state === "a_acabar").length;
  const out = list.filter((i) => i.state === "esgotado").length;
  const categories = [...new Set(list.map((i) => i.category).filter(Boolean))] as string[];

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Materiais da empresa: o que entra, o que se gasta e o que está a acabar."
        actions={
          <>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <SlidersHorizontal className="size-4" aria-hidden /> Personalizar campos
                </Button>
              </DialogTrigger>
              <DialogContent title="Campos do estoque" description="Crie os campos de que precisa (fornecedor, referência, preço…). Aparecem no formulário, na lista e na planilha." wide>
                <FieldsEditor entity="stock" title="Campos de cada material" onChange={fields.reload} />
              </DialogContent>
            </Dialog>
            <ItemDialog categories={categories} fields={fl} onDone={() => { items.reload(); fields.reload(); }} />
          </>
        }
      />
      <PageBody>
        <StatRow>
          <Stat label="Materiais" value={items.data ? list.length : "—"} />
          <Stat label="Quase a acabar" value={items.data ? low : "—"} hint="No mínimo ou abaixo" />
          <Stat label="Esgotados" value={items.data ? out : "—"} />
          <Stat
            label="Última contagem"
            value={(() => {
              const last = list.map((i) => i.lastCountedAt).filter(Boolean).sort().pop();
              return last ? formatDate(last) : "—";
            })()}
          />
        </StatRow>

        <Tabs
          items={[
            { key: "materiais", label: "Materiais", count: items.data ? list.length : undefined },
            { key: "mes", label: "Resumo do mês" },
            { key: "arquivo", label: "Arquivados" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {items.error ? <ErrorBlock message={items.error} /> : null}
        {tab === "materiais" ? (
          !items.data && !items.error ? (
            <LoadingBlock rows={4} />
          ) : items.data ? (
            <Materials items={list} categories={categories} fields={fl} reload={items.reload} />
          ) : null
        ) : tab === "mes" ? (
          <MonthSummary fields={fl} />
        ) : (
          <Archived onRestore={items.reload} />
        )}
      </PageBody>
    </>
  );
}

function Materials({ items, categories, fields, reload }: { items: StockItem[]; categories: string[]; fields: CustomField[]; reload: () => void }) {
  const { company } = useCompany();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<"todos" | "alerta">("todos");
  const t = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (filter === "todos" || i.state !== "ok") &&
      (!t || i.name.toLowerCase().includes(t) || (i.category ?? "").toLowerCase().includes(t) || JSON.stringify(i.extra ?? {}).toLowerCase().includes(t)),
  );

  if (!items.length) {
    return (
      <EmptyState
        title="Ainda sem materiais"
        description="Adicione os materiais do estoque com a quantidade que existe hoje e o mínimo para o aviso de que está a acabar."
        action={<ItemDialog categories={categories} fields={fields} onDone={reload} />}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar material ou categoria" aria-label="Procurar material" className="sm:max-w-xs" />
        <div className="flex gap-1.5">
          {(
            [
              ["todos", "Todos"],
              ["alerta", "A acabar e esgotados"],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "primary" : "soft"} onClick={() => setFilter(k)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      {!shown.length ? (
        <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] text-muted">Nenhum material com esse filtro.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {shown.map((i) => (
              <li key={i.id} className="grid gap-3 px-4 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-6">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-bold">{i.name}</span>
                    <Badge tone={STOCK_STATE[i.state].tone}>{STOCK_STATE[i.state].label}</Badge>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {[i.category, `mínimo ${qty(i.minQuantity)} ${i.unit}`, i.lastCountedAt ? `contado a ${formatDate(i.lastCountedAt)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {filledPairs(fields, i.extra, company.currency).length ? (
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {filledPairs(fields, i.extra, company.currency).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <p className={cn("text-[22px] leading-none font-bold tabular md:text-right", i.state === "esgotado" && "text-danger")}>
                  {qty(i.quantity)} <span className="text-[13px] font-medium text-muted">{i.unit}</span>
                </p>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  <MoveDialog item={i} kind="entrada" onDone={reload} />
                  <MoveDialog item={i} kind="saida" onDone={reload} />
                  <MoveDialog item={i} kind="contagem" onDone={reload} />
                  <HistoryDialog item={i} />
                  <ItemDialog item={i} categories={categories} fields={fields} onDone={reload} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ItemDialog({ item, categories, fields, onDone }: { item?: StockItem; categories: string[]; fields: CustomField[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{item ? <Button size="sm" variant="ghost">Editar</Button> : <Button>Novo material</Button>}</DialogTrigger>
      <DialogContent title={item ? `Editar ${item.name}` : "Novo material"} description={item ? undefined : "A quantidade inicial fica registada como a primeira entrada."}>
        <ActionForm
          resetOnSuccess={!item}
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const g = (k: string) => String(fd.get(k) ?? "").trim();
              await rpc("ps_stock_save", {
                p_company: companyId,
                p_id: item?.id ?? null,
                p: { name: g("name"), category: g("category"), unit: g("unit"), minQuantity: g("min").replace(",", "."), quantity: g("quantity").replace(",", "."), notes: g("notes"), extra: readExtra(fd, fields) },
              });
              onDone();
              return item ? "Material actualizado." : "Material adicionado.";
            })
          }
        >
          <Field label="Nome"><Input name="name" required defaultValue={item?.name} placeholder="Ex.: Verniz transparente" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <Input name="category" list="stock-cats" defaultValue={item?.category ?? ""} placeholder="Ex.: Pintura" />
            </Field>
            <Field label="Unidade">
              <Select name="unit" defaultValue={item?.unit ?? "un"}>
                {[...new Set([...UNITS, item?.unit ?? "un"])].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
          <datalist id="stock-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="grid grid-cols-2 gap-3">
            {!item ? (
              <Field label="Quantidade de hoje"><Input name="quantity" inputMode="decimal" defaultValue="0" /></Field>
            ) : null}
            <Field label="Mínimo" hint="Abaixo disto: quase a acabar">
              <Input name="min" inputMode="decimal" defaultValue={item ? String(item.minQuantity) : "0"} />
            </Field>
          </div>
          <CustomFieldInputs fields={fields} values={item?.extra} />
          <Field label="Notas"><Textarea name="notes" defaultValue={item?.notes ?? ""} className="min-h-16" placeholder="Onde está guardado, observações…" /></Field>
          <SubmitButton className="w-full">{item ? "Guardar" : "Adicionar material"}</SubmitButton>
          {item ? (
            <ActionButton
              type="button"
              variant="danger-outline"
              className="w-full"
              confirm={`Arquivar "${item.name}"? Deixa de aparecer na lista (o histórico mantém-se).`}
              action={() =>
                attempt(async () => {
                  await rpc("ps_stock_archive", { p_item: item.id, p_active: false });
                  setOpen(false);
                  onDone();
                  return "Material arquivado.";
                })
              }
            >
              Arquivar material
            </ActionButton>
          ) : null}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

const MOVE_TEXT = {
  entrada: { button: "Entrada", title: "Entrada de", label: "Quantidade que chegou", submit: "Registar entrada", done: "Entrada registada." },
  saida: { button: "Saída", title: "Saída de", label: "Quantidade gasta", submit: "Registar saída", done: "Saída registada." },
  contagem: { button: "Contar", title: "Contagem de", label: "Quantidade contada agora", submit: "Guardar contagem", done: "Contagem guardada." },
} as const;

function MoveDialog({ item, kind, onDone }: { item: StockItem; kind: Movement["kind"]; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const t = MOVE_TEXT[kind];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={kind === "contagem" ? "outline" : "soft"}>{t.button}</Button>
      </DialogTrigger>
      <DialogContent
        title={`${t.title} ${item.name}`}
        description={`Há ${qty(item.quantity)} ${item.unit}.${kind === "contagem" ? " Conte o que existe e escreva o número: o estoque fica certo e a diferença fica registada." : ""}`}
      >
        <ActionForm
          onSuccess={() => setOpen(false)}
          className="space-y-4"
          action={(_p, fd) =>
            attempt(async () => {
              const v = Number(String(fd.get("qty") ?? "").replace(",", "."));
              if (!Number.isFinite(v) || v < 0) throw new Error("Indique uma quantidade válida.");
              const r = await rpc<{ quantity: number }>("ps_stock_move", { p_item: item.id, p_kind: kind, p_qty: v, p_note: String(fd.get("note") ?? "") });
              onDone();
              return `${t.done} Fica com ${qty(r.quantity)} ${item.unit}.`;
            })
          }
        >
          <Field label={`${t.label} (${item.unit})`}>
            <Input name="qty" inputMode="decimal" required autoFocus defaultValue={kind === "contagem" ? String(item.quantity) : ""} />
          </Field>
          <Field label="Nota (opcional)">
            <Input name="note" placeholder={kind === "entrada" ? "Ex.: compra ao fornecedor" : kind === "saida" ? "Ex.: usado na pintura" : "Ex.: contagem do fim do mês"} />
          </Field>
          <SubmitButton className="w-full">{t.submit}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ item }: { item: StockItem }) {
  const { tz } = useCompany();
  const [open, setOpen] = React.useState(false);
  const data = useData(() => (open ? rpc<Movement[]>("ps_stock_history", { p_item: item.id }) : Promise.resolve(null)), [open, item.id, item.quantity]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">Histórico</Button>
      </DialogTrigger>
      <DialogContent title={`Histórico de ${item.name}`} description={`Agora: ${qty(item.quantity)} ${item.unit}`} wide>
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data ? (
          <LoadingBlock rows={3} />
        ) : !data.data.length ? (
          <p className="text-[13.5px] text-muted">Ainda sem movimentos.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {data.data.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13.5px]">
                <div className="min-w-0">
                  <p className="font-bold">
                    {KIND_LABEL[m.kind]}
                    {m.plate ? <span className="font-medium text-muted"> · viatura {m.plate}</span> : null}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {[formatDateTime(m.at, tz), m.by, m.note].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular">
                  <p className={cn("font-bold", m.delta < 0 ? "text-danger" : m.delta > 0 ? "text-success" : "text-muted")}>
                    {m.delta > 0 ? "+" : ""}
                    {qty(m.delta)}
                  </p>
                  <p className="text-[12px] text-muted">fica {qty(m.balance)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MonthSummary({ fields }: { fields: CustomField[] }) {
  const { companyId, company, tz } = useCompany();
  const [month, setMonth] = React.useState(currentMonth(tz));
  const data = useData(() => rpc<MonthRow[]>("ps_stock_month", { p_company: companyId, p_month: month }), [companyId, month]);
  const [y, m] = month.split("-").map(Number);

  const exportExcel = (mode: "download" | "share") =>
    attempt(async () => {
      const rows = (data.data ?? []).map((r) => ({
        name: r.name,
        category: r.category ?? "",
        unit: r.unit,
        start: Number(r.start),
        entradas: Number(r.entradas),
        saidas: Number(r.saidas),
        acertos: Number(r.acertos),
        end: Number(r.end),
        state: STOCK_STATE[r.state].label,
        ...Object.fromEntries(fields.map((f) => [f.id, showValue(f, r.extra?.[f.id], company.currency)])),
      }));
      const blob = await buildWorkbook([
        {
          name: "Estoque",
          title: `${company.companyName} — Estoque de ${periodLabel(y, m)}`,
          columns: [
            { header: "Material", key: "name", width: 32 },
            { header: "Categoria", key: "category", width: 18 },
            { header: "Unidade", key: "unit", width: 10 },
            { header: "Início do mês", key: "start", width: 14 },
            { header: "Entradas", key: "entradas", width: 12 },
            { header: "Saídas", key: "saidas", width: 12 },
            { header: "Acertos (contagem)", key: "acertos", width: 18 },
            { header: "Fim do mês", key: "end", width: 14 },
            { header: "Estado", key: "state", width: 16 },
            ...fields.map((f) => ({ header: f.label, key: f.id, width: 18 })),
          ],
          rows,
        },
      ]);
      if (mode === "share") {
        const r = await shareFile(blob, `estoque-${month}.xlsx`, `Estoque — ${periodLabel(y, m)}`);
        return r === "shared" ? "Planilha enviada." : r === "cancelled" ? undefined : "Planilha descarregada.";
      }
      downloadBlob(blob, `estoque-${month}.xlsx`);
      return "Planilha descarregada.";
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthPicker value={month} onChange={setMonth} max={currentMonth(tz)} />
        <div className="flex flex-wrap gap-2">
          <ActionButton size="sm" variant="outline" disabled={!data.data?.length} action={() => exportExcel("download")}>
            Descarregar Excel
          </ActionButton>
          {canShareFiles() ? (
            <ActionButton size="sm" disabled={!data.data?.length} action={() => exportExcel("share")}>
              Enviar planilha
            </ActionButton>
          ) : null}
        </div>
      </div>
      {data.error ? <ErrorBlock message={data.error} /> : null}
      {!data.data && !data.error ? <LoadingBlock rows={4} /> : null}
      {data.data && !data.data.length ? <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] text-muted">Sem materiais neste mês.</p> : null}
      {data.data?.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Material</TH>
                <TH className="text-right">Início</TH>
                <TH className="text-right">Entradas</TH>
                <TH className="text-right">Saídas</TH>
                <TH className="text-right">Acertos</TH>
                <TH className="text-right">Fim</TH>
                <TH>Estado</TH>
              </tr>
            </THead>
            <tbody>
              {data.data.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <span className="font-bold">{r.name}</span>
                    <span className="block text-[12px] text-muted">{r.unit}</span>
                  </TD>
                  <TD className="text-right tabular">{qty(r.start)}</TD>
                  <TD className="text-right text-success tabular">{Number(r.entradas) ? `+${qty(r.entradas)}` : "—"}</TD>
                  <TD className="text-right text-danger tabular">{Number(r.saidas) ? `−${qty(r.saidas)}` : "—"}</TD>
                  <TD className="text-right tabular">{Number(r.acertos) ? `${r.acertos > 0 ? "+" : ""}${qty(r.acertos)}` : "—"}</TD>
                  <TD className="text-right font-bold tabular">{qty(r.end)}</TD>
                  <TD><Badge tone={STOCK_STATE[r.state].tone}>{STOCK_STATE[r.state].label}</Badge></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : null}
    </div>
  );
}

function Archived({ onRestore }: { onRestore: () => void }) {
  const { companyId } = useCompany();
  const data = useData(() => loadStock(companyId, true), [companyId]);
  if (data.error) return <ErrorBlock message={data.error} />;
  if (!data.data) return <LoadingBlock rows={2} />;
  if (!data.data.length) return <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] text-muted">Nenhum material arquivado.</p>;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.data.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="min-w-0">
              <span className="block truncate font-bold">{i.name}</span>
              <span className="text-[12.5px] text-muted">{qty(i.quantity)} {i.unit}</span>
            </span>
            <ActionButton
              size="sm"
              variant="outline"
              action={() =>
                attempt(async () => {
                  await rpc("ps_stock_archive", { p_item: i.id, p_active: true });
                  data.reload();
                  onRestore();
                  return "Material reposto.";
                })
              }
            >
              Repor
            </ActionButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}
