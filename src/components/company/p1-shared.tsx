"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice, Skeleton } from "@/components/ui/misc";
import type { Tone } from "@/components/ui/badge";
import { must, sb } from "@/lib/sb/client";
import { useData, withBase } from "@/lib/sb/use-data";
import { useCompany } from "@/lib/sb/session";
import { localDate } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/labels";

export const ABSENCE_TYPES: Record<string, string> = {
  doenca: "Doença",
  consulta: "Consulta médica",
  falecimento: "Falecimento de familiar",
  casamento: "Casamento",
  parentalidade: "Parentalidade",
  formacao: "Formação / exames",
  servico: "Serviço externo",
  outro: "Outro motivo",
};

export const CONTRACT_LABEL: Record<string, string> = {
  indeterminado: "Prazo indeterminado",
  determinado: "Prazo determinado",
  estagio: "Estágio",
  prestacao_servicos: "Prestação de serviços",
};

export const EMPLOYEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Activo", tone: "success" },
  inactive: { label: "Inactivo", tone: "neutral" },
  terminated: { label: "Cessado", tone: "danger" },
};

export type DailyStatusCode =
  | "on_time" | "late" | "incomplete" | "absent_pending" | "justified" | "unjustified" | "review" | "holiday" | "day_off" | "present";

/** Data de hoje (YYYY-MM-DD) no fuso da empresa. */
export function todayIn(tz: string) {
  return localDate(new Date(), tz);
}

/** Opções de organização (departamentos, filiais, horários) da empresa activa. */
export type OrgOptions = {
  departments: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  schedules: { id: string; name: string }[];
};

export function useOrgOptions() {
  const { companyId } = useCompany();
  return useData<OrgOptions>(async () => {
    const [d, b, s] = await Promise.all([
      sb().from("departments").select("id,name").eq("company_id", companyId).order("name"),
      sb().from("branches").select("id,name").eq("company_id", companyId).order("name"),
      sb().from("work_schedules").select("id,name").eq("company_id", companyId).order("name"),
    ]);
    return { departments: must(d) ?? [], branches: must(b) ?? [], schedules: must(s) ?? [] };
  }, [companyId]);
}

/** Papéis que o utilizador actual pode atribuir. */
export function useAssignableRoles() {
  const { can, company } = useCompany();
  const roles: { code: string; label: string }[] = [{ code: "employee", label: ROLE_LABEL.employee }];
  if (can("users.manage")) {
    for (const code of ["supervisor", "hr", "finance", "admin"]) roles.push({ code, label: ROLE_LABEL[code] });
    if (company.role === "owner") roles.push({ code: "owner", label: ROLE_LABEL.owner });
  }
  return roles;
}

/** Palavra-passe legível (sem caracteres ambíguos), fácil de ditar ao colaborador. */
export function generatePassword() {
  const consonants = "bcdfghjkmnprstvz";
  const vowels = "aeiou";
  const digits = "23456789";
  const rnd = (n: number) => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  };
  const syllable = () => consonants[rnd(consonants.length)] + vowels[rnd(vowels.length)];
  const word = () => {
    const w = syllable() + syllable();
    return w[0].toUpperCase() + w.slice(1);
  };
  return `${word()}-${word()}-${digits[rnd(digits.length)]}${digits[rnd(digits.length)]}`;
}

/** Sugestão de utilizador a partir do nome ("Ana Maria Sitoe" → "ana.sitoe"). */
export function suggestLogin(fullName: string) {
  const parts = fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
}

export const LOGIN_PATTERN = "[A-Za-z0-9._@+\\-]{3,}";

export function validLogin(v: string) {
  return /^[a-z0-9._@+-]{3,}$/.test(v.trim().toLowerCase());
}

/** Campos de credenciais: utilizador + palavra-passe com botão "Gerar". */
export function CredentialFields({
  defaultLogin = "",
  loginRequired = true,
  passwordRequired = true,
  showLogin = true,
  suggestFrom,
}: {
  defaultLogin?: string;
  loginRequired?: boolean;
  passwordRequired?: boolean;
  showLogin?: boolean;
  suggestFrom?: () => string;
}) {
  const [login, setLogin] = React.useState(defaultLogin);
  const [password, setPassword] = React.useState("");
  return (
    <>
      {showLogin ? (
        <Field label="Utilizador" hint="Letras, números, ponto ou hífen (ex.: ana.sitoe) — ou um email.">
          <div className="flex gap-2">
            <Input
              name="login"
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              required={loginRequired}
              minLength={3}
              pattern={LOGIN_PATTERN}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="ana.sitoe"
            />
            {suggestFrom ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const s = suggestFrom();
                  if (s) setLogin(s);
                  else toast.error("Escreva primeiro o nome completo.");
                }}
              >
                Sugerir
              </Button>
            ) : null}
          </div>
        </Field>
      ) : null}
      <Field
        label="Palavra-passe"
        hint={passwordRequired ? "Mínimo 8 caracteres. Não poderá ser consultada depois — anote-a ao guardar." : "Deixe em branco para manter a actual."}
      >
        <div className="flex gap-2">
          <Input
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={passwordRequired}
            minLength={8}
            autoComplete="new-password"
            spellCheck={false}
            className="font-mono"
          />
          <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
            <RefreshCw /> Gerar
          </Button>
        </div>
      </Field>
    </>
  );
}

export function RoleSelect({ defaultValue = "employee", name = "role" }: { defaultValue?: string; name?: string }) {
  const roles = useAssignableRoles();
  const options = roles.some((r) => r.code === defaultValue) ? roles : [...roles, { code: defaultValue, label: ROLE_LABEL[defaultValue] ?? defaultValue }];
  return (
    <Field label="Papel" hint={roles.length === 1 ? "Só quem gere contas pode atribuir outros papéis." : "Define o que a pessoa pode ver e fazer no painel."}>
      <Select name={name} defaultValue={defaultValue}>
        {options.map((r) => (
          <option key={r.code} value={r.code} disabled={!roles.some((x) => x.code === r.code)}>
            {r.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Cartão com as credenciais a entregar ao colaborador (mostradas uma única vez). */
export function CredentialsCard({ name, login, password }: { name: string; login: string; password: string | null }) {
  const [copied, setCopied] = React.useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}${withBase("/login/")}` : "";
  const text = [`PontoSmart — acesso de ${name}`, `Endereço: ${url}`, `Utilizador: ${login}`, password ? `Palavra-passe: ${password}` : null]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="space-y-4">
      <Notice tone="warning" title={password ? "Entregue estas credenciais ao colaborador" : "Acesso actualizado"}>
        {password
          ? "A palavra-passe só é mostrada agora. Copie-a e entregue-a por um canal seguro; se a perder, terá de definir uma nova."
          : "O utilizador mantém a palavra-passe actual."}
      </Notice>
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-xs text-muted">Endereço</dt>
          <dd className="truncate text-[13px] font-medium">{url}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-xs text-muted">Utilizador</dt>
          <dd className="font-mono text-[14px] font-semibold break-all">{login}</dd>
        </div>
        {password ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-xs text-muted">Palavra-passe</dt>
            <dd className="font-mono text-[14px] font-semibold break-all">{password}</dd>
          </div>
        ) : null}
      </dl>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            toast.success("Credenciais copiadas.");
            setTimeout(() => setCopied(false), 2000);
          } catch {
            toast.error("Não foi possível copiar. Seleccione e copie manualmente.");
          }
        }}
      >
        {copied ? <Check /> : <Copy />} Copiar credenciais
      </Button>
    </div>
  );
}

/** Bloco de carregamento genérico. */
export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Retira caracteres que quebram filtros `or()` do PostgREST. */
export function cleanSearch(q: string) {
  return q.replace(/[,()*%\\]/g, " ").trim();
}

/** Abre um anexo privado do Storage com URL assinado (2 minutos). */
export async function openSignedFile(bucket: string, key: string) {
  const w = window.open("", "_blank");
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(key, 120);
  if (error || !data?.signedUrl) {
    w?.close();
    toast.error("Não foi possível abrir o anexo.");
    return;
  }
  if (w) w.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
