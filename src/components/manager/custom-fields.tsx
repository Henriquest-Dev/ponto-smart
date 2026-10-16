"use client";

import { ArrowDown, ArrowUp, PencilSimple, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { errorMessage, rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

export type FieldEntity = "vehicle" | "visit" | "stock";
export type FieldKind = "text" | "longtext" | "number" | "date" | "select" | "yesno";
export type CustomField = { id: string; entity: FieldEntity; label: string; kind: FieldKind; options: string[]; position: number };
export type Extra = Record<string, string | number | boolean | null>;

export const KIND_LABEL: Record<FieldKind, string> = {
  text: "Texto curto",
  longtext: "Texto longo",
  number: "Número",
  date: "Data",
  select: "Lista de opções",
  yesno: "Sim ou não",
};

/** Ideias de campos para começar (um toque e ficam criados). */
export const SUGGESTIONS: Record<FieldEntity, { label: string; kind: FieldKind; options?: string[] }[]> = {
  vehicle: [
    { label: "Ano", kind: "number" },
    { label: "Nº do chassis", kind: "text" },
    { label: "Combustível", kind: "select", options: ["Gasolina", "Diesel", "Híbrido", "Eléctrico"] },
    { label: "Seguradora", kind: "text" },
    { label: "Email do cliente", kind: "text" },
  ],
  visit: [
    { label: "Técnico responsável", kind: "text" },
    { label: "Entrega prevista", kind: "date" },
    { label: "Pago", kind: "yesno" },
    { label: "Forma de pagamento", kind: "select", options: ["Numerário", "M-Pesa", "e-Mola", "Transferência", "Cartão"] },
    { label: "Estado da viatura à chegada", kind: "longtext" },
  ],
  stock: [
    { label: "Fornecedor", kind: "text" },
    { label: "Referência", kind: "text" },
    { label: "Preço unitário (MZN)", kind: "number" },
    { label: "Localização no armazém", kind: "text" },
  ],
};

export function useCustomFields(entity: FieldEntity) {
  const { companyId } = useCompany();
  return useData(
    () =>
      rpc<CustomField[]>("ps_custom_fields", { p_company: companyId, p_entity: entity }).catch((e) => {
        // Sem o script 04_parte13.sql ainda não há campos personalizados: segue sem eles.
        if (/ps_custom_fields|função em falta|schema cache/i.test(errorMessage(e))) return [] as CustomField[];
        throw e;
      }),
    [companyId, entity],
  );
}

/** Valor para mostrar ao utilizador. */
export function showValue(f: CustomField, v: unknown, currency = "MZN"): string {
  if (v === null || v === undefined || v === "") return "";
  if (f.kind === "yesno") return v === true || v === "true" ? "Sim" : "Não";
  if (f.kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  if (f.kind === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return /mzn|preço|valor|custo/i.test(f.label) ? formatMoney(n, currency) : n.toLocaleString("pt-PT");
  }
  return String(v);
}

/** Pares "rótulo: valor" só dos campos preenchidos. */
export function filledPairs(fields: CustomField[], extra: Extra | null | undefined, currency?: string): [string, string][] {
  return fields.map((f) => [f.label, showValue(f, extra?.[f.id], currency)] as [string, string]).filter(([, v]) => v !== "");
}

/** Lê os campos personalizados de um formulário (nomes x_<id>). */
export function readExtra(fd: FormData, fields: CustomField[]): Extra {
  const out: Extra = {};
  for (const f of fields) {
    const raw = fd.get(`x_${f.id}`);
    if (f.kind === "yesno") out[f.id] = raw === "on";
    else if (f.kind === "number") {
      const t = String(raw ?? "").replace(/\s/g, "").replace(",", ".");
      if (t && !Number.isFinite(Number(t))) throw new Error(`"${f.label}" tem de ser um número.`);
      out[f.id] = t ? Number(t) : null;
    } else out[f.id] = String(raw ?? "").trim() || null;
  }
  return out;
}

/** Entrada de um campo personalizado (para formulários e para a planilha). */
export function CustomInput({
  field: f,
  value,
  name,
  className,
  autoFocus,
  onCommit,
}: {
  field: CustomField;
  value: unknown;
  name?: string;
  className?: string;
  autoFocus?: boolean;
  onCommit?: (v: string | number | boolean | null) => void;
}) {
  const v = value === null || value === undefined ? "" : String(value);
  const commit = (raw: string | boolean) => {
    if (!onCommit) return;
    if (f.kind === "yesno") return onCommit(raw === true);
    if (f.kind === "number") {
      const t = String(raw).replace(/\s/g, "").replace(",", ".");
      return onCommit(t && Number.isFinite(Number(t)) ? Number(t) : null);
    }
    onCommit(String(raw).trim() || null);
  };
  const blur = onCommit ? { onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => commit(e.currentTarget.value) } : {};
  if (f.kind === "yesno")
    return (
      <Checkbox
        name={name}
        defaultChecked={value === true || value === "true"}
        autoFocus={autoFocus}
        onChange={onCommit ? (e) => commit(e.currentTarget.checked) : undefined}
        aria-label={f.label}
      />
    );
  if (f.kind === "select")
    return (
      <Select name={name} defaultValue={v} className={className} autoFocus={autoFocus} {...blur} aria-label={f.label}>
        <option value="">—</option>
        {[...new Set([...f.options, ...(v && !f.options.includes(v) ? [v] : [])])].map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    );
  if (f.kind === "longtext")
    return <Textarea name={name} defaultValue={v} className={cn("min-h-16", className)} autoFocus={autoFocus} {...blur} aria-label={f.label} />;
  return (
    <Input
      name={name}
      type={f.kind === "date" ? "date" : "text"}
      inputMode={f.kind === "number" ? "decimal" : undefined}
      defaultValue={v}
      className={className}
      autoFocus={autoFocus}
      {...blur}
      aria-label={f.label}
    />
  );
}

/** Os campos personalizados dentro de um formulário. */
export function CustomFieldInputs({ fields, values }: { fields: CustomField[]; values?: Extra | null }) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) =>
        f.kind === "yesno" ? (
          <label key={f.id} className="flex items-center gap-2.5 self-end rounded-lg border border-border px-3 py-2.5 text-[13.5px] font-bold">
            <CustomInput field={f} value={values?.[f.id]} name={`x_${f.id}`} /> {f.label}
          </label>
        ) : (
          <Field key={f.id} label={f.label} className={f.kind === "longtext" ? "sm:col-span-2" : undefined}>
            <CustomInput field={f} value={values?.[f.id]} name={`x_${f.id}`} />
          </Field>
        ),
      )}
    </div>
  );
}

/** Criar, mudar o nome, mudar a ordem e remover campos. */
export function FieldsEditor({ entity, title, onChange }: { entity: FieldEntity; title: string; onChange?: () => void }) {
  const { companyId } = useCompany();
  const fields = useCustomFields(entity);
  const [editing, setEditing] = React.useState<CustomField | "new" | null>(null);
  const list = fields.data ?? [];
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      fields.reload();
      onChange?.();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const unused = SUGGESTIONS[entity].filter((s) => !list.some((f) => f.label.toLowerCase() === s.label.toLowerCase()));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold">{title}</p>
        <Button size="sm" variant="soft" onClick={() => setEditing("new")}>Novo campo</Button>
      </div>
      {fields.error ? <p className="text-[13px] text-danger">{fields.error}</p> : null}
      {editing === "new" ? (
        <FieldForm
          entity={entity}
          onCancel={() => setEditing(null)}
          onSave={(p) => run(async () => {
            await rpc("ps_custom_field_save", { p_company: companyId, p_id: null, p: { ...p, entity } });
            setEditing(null);
          }, "Campo criado.")}
        />
      ) : null}
      {list.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {list.map((f, i) =>
            editing !== "new" && editing?.id === f.id ? (
              <li key={f.id} className="p-3">
                <FieldForm
                  entity={entity}
                  field={f}
                  onCancel={() => setEditing(null)}
                  onSave={(p) => run(async () => {
                    await rpc("ps_custom_field_save", { p_company: companyId, p_id: f.id, p });
                    setEditing(null);
                  }, "Campo guardado.")}
                />
              </li>
            ) : (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{f.label}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {KIND_LABEL[f.kind]}
                    {f.kind === "select" ? `: ${f.options.join(", ")}` : ""}
                  </span>
                </span>
                <IconBtn label={`Subir ${f.label}`} disabled={i === 0} onClick={() => run(() => rpc("ps_custom_field_move", { p_id: f.id, p_delta: -1 }))}>
                  <ArrowUp className="size-4" />
                </IconBtn>
                <IconBtn label={`Descer ${f.label}`} disabled={i === list.length - 1} onClick={() => run(() => rpc("ps_custom_field_move", { p_id: f.id, p_delta: 1 }))}>
                  <ArrowDown className="size-4" />
                </IconBtn>
                <IconBtn label={`Editar ${f.label}`} onClick={() => setEditing(f)}>
                  <PencilSimple className="size-4" />
                </IconBtn>
                <IconBtn
                  label={`Remover ${f.label}`}
                  danger
                  onClick={() =>
                    window.confirm(`Remover o campo "${f.label}"? Deixa de aparecer nos formulários; o que já foi escrito fica guardado.`) &&
                    run(() => rpc("ps_custom_field_delete", { p_id: f.id }), "Campo removido.")
                  }
                >
                  <Trash className="size-4" />
                </IconBtn>
              </li>
            ),
          )}
        </ul>
      ) : fields.data ? (
        <p className="rounded-xl bg-surface px-3 py-2.5 text-[13px] text-muted">Ainda sem campos próprios.</p>
      ) : null}
      {unused.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] text-muted">Sugestões:</span>
          {unused.map((s) => (
            <button
              key={s.label}
              type="button"
              className="rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12.5px] font-bold text-muted hover:border-primary hover:text-primary"
              onClick={() => run(() => rpc("ps_custom_field_save", { p_company: companyId, p_id: null, p: { ...s, entity } }), `Campo "${s.label}" criado.`)}
            >
              + {s.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30",
        danger && "hover:bg-danger-soft hover:text-danger",
      )}
    >
      {children}
    </button>
  );
}

function FieldForm({
  field,
  onSave,
  onCancel,
}: {
  entity: FieldEntity;
  field?: CustomField;
  onSave: (p: { label: string; kind: FieldKind; options: string[] }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = React.useState<FieldKind>(field?.kind ?? "text");
  return (
    <form
      className="space-y-3 rounded-xl border border-primary/40 bg-primary-soft/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          label: String(fd.get("label") ?? "").trim(),
          kind,
          options: String(fd.get("options") ?? "")
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do campo"><Input name="label" required autoFocus defaultValue={field?.label} placeholder="Ex.: Técnico responsável" /></Field>
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as FieldKind)}>
            {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
      </div>
      {kind === "select" ? (
        <Field label="Opções" hint="Separe por vírgulas">
          <Input name="options" required defaultValue={field?.options.join(", ")} placeholder="Ex.: Numerário, M-Pesa, Transferência" />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm">Guardar campo</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}
