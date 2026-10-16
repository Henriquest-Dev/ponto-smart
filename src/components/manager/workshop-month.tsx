"use client";

import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock } from "@/components/company/p2-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { MonthPicker, currentMonth } from "@/components/ui/month-picker";
import { Stat, StatRow } from "@/components/ui/stat";
import { buildWorkbook, downloadBlob } from "@/lib/excel";
import { formatDateTime, formatMoney, periodLabel } from "@/lib/format";
import { canShareFiles, shareFile } from "@/lib/share";
import { errorMessage, rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { localDateTimeInput } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CustomInput, showValue, useCustomFields, type CustomField, type Extra } from "./custom-fields";
import { VehicleAvatar } from "./photos";

export type MonthVisit = {
  id: string;
  vehicleId: string;
  plate: string;
  name: string;
  ownerName: string;
  ownerPhone: string | null;
  cover: string | null;
  vehicleExtra: Extra;
  enteredAt: string;
  finishedAt: string | null;
  status: "aberta" | "concluida";
  services: string[];
  description: string | null;
  mileage: number | null;
  amount: number | null;
  extra: Extra;
  firstVisit: boolean;
  materials: number;
  by: string | null;
};

type Col = {
  key: string;
  label: string;
  width: number;
  kind: "datetime" | "text" | "number" | "status" | "custom";
  target: "visit" | "vehicle";
  field?: CustomField;
  get: (r: MonthVisit) => unknown;
  show: (r: MonthVisit) => string;
  /** Converte o valor editado em alterações a enviar. */
  patch: (v: unknown) => Record<string, unknown>;
};

/** Resumo do mês da oficina: contagens, planilha editável e Excel para enviar. */
export function WorkshopMonth({ base }: { base: string }) {
  const { companyId, company, tz } = useCompany();
  const [month, setMonth] = React.useState(currentMonth(tz));
  const data = useData(() => rpc<MonthVisit[]>("ps_workshop_month", { p_company: companyId, p_month: month }), [companyId, month]);
  const visitFields = useCustomFields("visit");
  const vehicleFields = useCustomFields("vehicle");
  const [rows, setRows] = React.useState<MonthVisit[]>([]);
  React.useEffect(() => setRows(data.data ?? []), [data.data]);
  const [y, m] = month.split("-").map(Number);
  const money = (n: number | null) => (n ? formatMoney(n, company.currency) : "");

  const cols: Col[] = React.useMemo(() => {
    const c: Col[] = [
      {
        key: "enteredAt", label: "Entrada", width: 170, kind: "datetime", target: "visit",
        get: (r) => localDateTimeInput(r.enteredAt, tz), show: (r) => formatDateTime(r.enteredAt, tz),
        patch: (v) => ({ enteredAt: v }),
      },
      { key: "plate", label: "Matrícula", width: 120, kind: "text", target: "vehicle", get: (r) => r.plate, show: (r) => r.plate, patch: (v) => ({ plate: v }) },
      { key: "name", label: "Viatura", width: 160, kind: "text", target: "vehicle", get: (r) => r.name, show: (r) => r.name, patch: (v) => ({ name: v }) },
      { key: "ownerName", label: "Proprietário", width: 160, kind: "text", target: "vehicle", get: (r) => r.ownerName, show: (r) => r.ownerName, patch: (v) => ({ ownerName: v }) },
      { key: "ownerPhone", label: "Telefone", width: 120, kind: "text", target: "vehicle", get: (r) => r.ownerPhone ?? "", show: (r) => r.ownerPhone ?? "", patch: (v) => ({ ownerPhone: v }) },
      {
        key: "services", label: "Trabalhos", width: 200, kind: "text", target: "visit",
        get: (r) => r.services.join(", "), show: (r) => r.services.join(", "),
        patch: (v) => ({ services: String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean) }),
      },
      { key: "description", label: "Descrição", width: 240, kind: "text", target: "visit", get: (r) => r.description ?? "", show: (r) => r.description ?? "", patch: (v) => ({ description: v }) },
      {
        key: "status", label: "Estado", width: 130, kind: "status", target: "visit",
        get: (r) => r.status, show: (r) => (r.status === "aberta" ? "Na oficina" : "Concluída"), patch: (v) => ({ status: v }),
      },
      {
        key: "mileage", label: "Km", width: 100, kind: "number", target: "visit",
        get: (r) => r.mileage ?? "", show: (r) => (r.mileage ? r.mileage.toLocaleString("pt-PT") : ""), patch: (v) => ({ mileage: v ?? "" }),
      },
      { key: "amount", label: "Valor", width: 120, kind: "number", target: "visit", get: (r) => r.amount ?? "", show: (r) => money(r.amount), patch: (v) => ({ amount: v ?? "" }) },
    ];
    for (const f of visitFields.data ?? [])
      c.push({
        key: `v_${f.id}`, label: f.label, width: 150, kind: "custom", target: "visit", field: f,
        get: (r) => r.extra?.[f.id], show: (r) => showValue(f, r.extra?.[f.id], company.currency), patch: (v) => ({ extra: { [f.id]: v } }),
      });
    for (const f of vehicleFields.data ?? [])
      c.push({
        key: `c_${f.id}`, label: f.label, width: 150, kind: "custom", target: "vehicle", field: f,
        get: (r) => r.vehicleExtra?.[f.id], show: (r) => showValue(f, r.vehicleExtra?.[f.id], company.currency), patch: (v) => ({ extra: { [f.id]: v } }),
      });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitFields.data, vehicleFields.data, tz, company.currency]);

  /** Guarda uma célula: actualiza logo no ecrã e envia só esse campo. */
  const save = async (row: MonthVisit, col: Col, value: unknown) => {
    const before = rows;
    const p = col.patch(value);
    const apply = (r: MonthVisit): MonthVisit => {
      if (col.target === "vehicle" ? r.vehicleId !== row.vehicleId : r.id !== row.id) return r;
      const n = { ...r } as MonthVisit & Record<string, unknown>;
      if (col.kind === "custom") {
        if (col.target === "visit") n.extra = { ...r.extra, ...(p.extra as Extra) };
        else n.vehicleExtra = { ...r.vehicleExtra, ...(p.extra as Extra) };
      } else if (col.key === "enteredAt") n.enteredAt = new Date(`${value}`).toISOString();
      else if (col.key === "services") n.services = p.services as string[];
      else if (col.key === "mileage" || col.key === "amount") n[col.key] = value === null || value === "" ? null : Number(value);
      else n[col.key] = value;
      return n;
    };
    setRows((rs) => rs.map(apply));
    try {
      if (col.target === "vehicle") await rpc("ps_vehicle_update", { p_vehicle: row.vehicleId, p });
      else await rpc("ps_visit_save", { p_visit: row.id, p });
      if (col.key === "enteredAt") data.reload();
    } catch (e) {
      setRows(before);
      toast.error(errorMessage(e));
    }
  };

  // Contagens do mês
  const vehicles = new Set(rows.map((r) => r.vehicleId)).size;
  const fresh = rows.filter((r) => r.firstVisit).length;
  const done = rows.filter((r) => r.status === "concluida").length;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const byService = new Map<string, number>();
  for (const r of rows) for (const s of r.services) byService.set(s, (byService.get(s) ?? 0) + 1);
  const services = [...byService.entries()].sort((a, b) => b[1] - a[1]);
  const maxS = services[0]?.[1] ?? 1;

  const workbook = async () =>
    buildWorkbook([
      {
        name: "Resumo",
        title: `${company.companyName} — Oficina, ${periodLabel(y, m)}`,
        columns: [
          { header: "Indicador", key: "k", width: 34 },
          { header: "Valor", key: "v", width: 18 },
        ],
        rows: [
          { k: "Entradas na oficina", v: rows.length },
          { k: "Viaturas diferentes", v: vehicles },
          { k: "Viaturas novas (primeira vez)", v: fresh },
          { k: "Viaturas que voltaram", v: rows.length - fresh },
          { k: "Concluídas", v: done },
          { k: "Ainda na oficina", v: rows.length - done },
          { k: `Valor total (${company.currency})`, v: total },
          ...services.map(([s, n]) => ({ k: `Trabalho: ${s}`, v: n })),
        ],
      },
      {
        name: "Entradas",
        title: `${company.companyName} — Viaturas na oficina, ${periodLabel(y, m)}`,
        columns: [
          ...cols.map((c) => ({ header: c.label, key: c.key, width: Math.round(c.width / 7), numFmt: c.key === "amount" ? "#,##0.00" : undefined })),
          { header: "Primeira vez", key: "first", width: 12 },
          { header: "Materiais usados", key: "mat", width: 14 },
          { header: "Registado por", key: "by", width: 20 },
        ],
        rows: rows.map((r) => ({
          ...Object.fromEntries(cols.map((c) => [c.key, c.key === "amount" || c.key === "mileage" ? (c.get(r) === "" ? null : Number(c.get(r))) : c.show(r)])),
          first: r.firstVisit ? "Sim" : "Não",
          mat: r.materials,
          by: r.by ?? "",
        })),
      },
    ]);

  const exportFile = async (mode: "download" | "share") => {
    try {
      const blob = await workbook();
      const name = `oficina-${month}.xlsx`;
      if (mode === "download") {
        downloadBlob(blob, name);
        return void toast.success("Planilha descarregada.");
      }
      const r = await shareFile(blob, name, `Oficina — ${periodLabel(y, m)}`);
      if (r !== "cancelled") toast.success(r === "shared" ? "Planilha enviada." : "Planilha descarregada.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthPicker value={month} onChange={setMonth} max={currentMonth(tz)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => void exportFile("download")}>Descarregar Excel</Button>
          {canShareFiles() ? (
            <Button size="sm" disabled={!rows.length} onClick={() => void exportFile("share")}>Enviar planilha</Button>
          ) : null}
        </div>
      </div>
      {data.error ? <ErrorBlock message={data.error} /> : null}
      {!data.data && !data.error ? <LoadingBlock rows={4} /> : null}
      {data.data ? (
        <>
          <StatRow>
            <Stat label="Entradas no mês" value={rows.length} hint={`${vehicles} ${vehicles === 1 ? "viatura" : "viaturas"}`} />
            <Stat label="Viaturas novas" value={fresh} hint={`${rows.length - fresh} voltaram`} />
            <Stat label="Concluídas" value={done} hint={`${rows.length - done} na oficina`} />
            <Stat label="Valor" value={formatMoney(total, company.currency)} />
          </StatRow>

          {services.length ? (
            <Card className="p-4 sm:p-5">
              <p className="mb-3 text-[14px] font-bold">Trabalhos do mês</p>
              <ul className="space-y-2">
                {services.map(([s, n]) => (
                  <li key={s} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-[13px]">
                    <span className="truncate font-bold">{s}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${(n / maxS) * 100}%` }} />
                    </span>
                    <span className="tabular">{n}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {rows.length ? (
            <section className="space-y-2">
              <p className="text-[13px] text-muted">Toque numa célula para a editar. As alterações ficam guardadas logo e entram na planilha.</p>
              <div className="overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-max min-w-full border-collapse text-[13px]">
                  <thead className="bg-surface text-left text-[12px] font-bold text-muted">
                    <tr>
                      <th className="sticky left-0 z-10 bg-surface px-3 py-2">Viatura</th>
                      {cols.map((c) => (
                        <th key={c.key} className="px-3 py-2 whitespace-nowrap" style={{ minWidth: c.width }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                          <Link href={`${base}/oficina/viatura/?id=${r.vehicleId}`} className="flex items-center gap-2" aria-label={`Abrir ${r.plate}`}>
                            <VehicleAvatar photoKey={r.cover} plate={r.plate} className="size-9 rounded-lg" />
                            {r.firstVisit ? <Badge tone="info" className="h-5 px-1.5 text-[10.5px]">Nova</Badge> : null}
                          </Link>
                        </td>
                        {cols.map((c) => (
                          <Cell key={c.key} col={c} row={r} onSave={(v) => void save(r, c, v)} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="rounded-xl bg-surface px-4 py-3 text-[13.5px] text-muted">Nenhuma viatura entrou na oficina neste mês.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function Cell({ col, row, onSave }: { col: Col; row: MonthVisit; onSave: (v: unknown) => void }) {
  const [editing, setEditing] = React.useState(false);
  const current = col.get(row);
  const finish = (v: unknown) => {
    setEditing(false);
    const norm = (x: unknown) => (x === null || x === undefined ? "" : String(x));
    if (norm(v) !== norm(current)) onSave(v === "" ? null : v);
  };
  const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") setEditing(false);
  };
  if (!editing)
    return (
      <td className="p-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "block min-h-11 w-full px-3 py-2 text-left hover:bg-primary-soft/50 focus-visible:bg-primary-soft/50 focus-visible:outline-none",
            col.kind === "number" && "text-right tabular",
          )}
          style={{ minWidth: col.width, maxWidth: col.width * 1.6 }}
          aria-label={`Editar ${col.label}`}
        >
          <span className="line-clamp-2">{col.show(row) || <span className="text-subtle">—</span>}</span>
        </button>
      </td>
    );
  return (
    <td className="p-1" style={{ minWidth: col.width }}>
      {col.kind === "custom" && col.field ? (
        <CustomInput field={col.field} value={current} autoFocus className="h-9" onCommit={(v) => finish(v)} />
      ) : col.kind === "status" ? (
        <Select autoFocus defaultValue={String(current)} className="h-9" onBlur={(e) => finish(e.currentTarget.value)} onChange={(e) => finish(e.currentTarget.value)} onKeyDown={keys}>
          <option value="aberta">Na oficina</option>
          <option value="concluida">Concluída</option>
        </Select>
      ) : (
        <Input
          autoFocus
          type={col.kind === "datetime" ? "datetime-local" : "text"}
          inputMode={col.kind === "number" ? "decimal" : undefined}
          defaultValue={String(current ?? "")}
          className="h-9"
          onBlur={(e) => finish(e.currentTarget.value.trim())}
          onKeyDown={keys}
        />
      )}
    </td>
  );
}
