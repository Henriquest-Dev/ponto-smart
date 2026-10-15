"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
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
  formacao: "Formação ou exames",
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
        <Field label="Utilizador" hint="Letras, números, ponto ou hífen (ex.: ana.sitoe), ou um email.">
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
        hint={passwordRequired ? "Mínimo 8 caracteres. Não poderá ser consultada depois, anote-a ao guardar." : "Deixe em branco para manter a actual."}
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
            Gerar
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
  const text = [`Horbit — acesso de ${name}`, `Endereço: ${url}`, `Utilizador: ${login}`, password ? `Palavra-passe: ${password}` : null]
    .filter(Boolean)
    .join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Credenciais copiadas.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Seleccione e copie manualmente.");
    }
  };
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[22px] border-2 border-foreground/90">
        <div className="flex items-end justify-between gap-3 bg-foreground px-5 py-4 text-background sm:px-6">
          <div className="min-w-0">
            <p className="text-[18px] leading-none font-extrabold tracking-[-0.02em]">Horbit</p>
            <p className="mt-1.5 truncate text-[13px] opacity-75">Credenciais de acesso de {name}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold">
            <span className="stem h-3 text-primary-soft" aria-hidden />
            {password ? "Pessoal e intransmissível" : "Acesso actualizado"}
          </span>
        </div>
        <dl className="divide-y divide-border bg-background">
          <CredentialLine label="Endereço" value={url} />
          <CredentialLine label="Utilizador" value={login} mono strong />
          {password ? <CredentialLine label="Palavra-passe" value={password} mono strong /> : null}
        </dl>
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        {password ? (
          <>
            <span className="font-bold text-foreground">A palavra-passe só é mostrada agora.</span> Entregue-a ao colaborador por um canal
            seguro. Se a perder, terá de definir uma nova na ficha.
          </>
        ) : (
          "O utilizador mantém a palavra-passe actual."
        )}
      </p>

      <Button type="button" size="lg" className="w-full" onClick={copy}>
        {copied ? "Copiado" : "Copiar credenciais"}
      </Button>
    </div>
  );
}

function CredentialLine({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[130px_1fr] sm:items-baseline sm:gap-4 sm:px-6">
      <dt className="text-[13px] font-bold text-muted">{label}</dt>
      <dd
        className={
          strong
            ? `select-all text-[20px] leading-tight font-extrabold tracking-[-0.01em] break-all ${mono ? "font-mono" : ""}`
            : "select-all text-[14px] font-bold break-all"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** Bloco de carregamento genérico. */
export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-[14px]" />
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
