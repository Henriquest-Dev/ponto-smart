"use client";

import type { Tone } from "@/components/ui/badge";
import { rpc } from "@/lib/sb/client";

/* ------------------------------------------------------------------ */
/* Tipos devolvidos por ps_admin_overview()                            */
/* ------------------------------------------------------------------ */

export type CompanyStatus = "trial" | "active" | "suspended" | "cancelled";

export type AdminCompany = {
  id: string;
  name: string;
  nuit: string | null;
  email: string | null;
  phone: string | null;
  status: CompanyStatus;
  created_at: string;
  employees: number;
  plan: string | null;
  plan_code: string | null;
  price_monthly: number | string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  owner_login: string | null;
  last_activity: string | null;
};

export type AdminRequest = {
  id: string;
  company_name: string;
  nuit: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  employees_estimate: number | null;
  plan_id: string | null;
  plan: string | null;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  company_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  price_monthly: number | string;
  currency: string;
  max_employees: number;
  modules: string[];
  active: boolean;
  created_at?: string;
};

export type Overview = {
  companies: AdminCompany[];
  requests: AdminRequest[];
  plans: Plan[];
  activity: { date: string; events: number; companies: number }[];
  growth: { month: string; companies: number; employees: number }[];
};

export async function loadOverview(): Promise<Overview> {
  const o = await rpc<Partial<Overview> | null>("ps_admin_overview");
  return {
    companies: (o?.companies ?? []).map((c) => ({ ...c, employees: Number(c.employees ?? 0) })),
    requests: o?.requests ?? [],
    plans: (o?.plans ?? []).map((p) => ({ ...p, modules: Array.isArray(p.modules) ? p.modules : [] })),
    activity: (o?.activity ?? []).map((a) => ({ date: String(a.date).slice(0, 10), events: Number(a.events), companies: Number(a.companies) })),
    growth: (o?.growth ?? []).map((g) => ({ month: g.month, companies: Number(g.companies), employees: Number(g.employees) })),
  };
}

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */

export const COMPANY_STATUS: Record<string, { label: string; tone: Tone }> = {
  trial: { label: "Activa", tone: "success" },
  active: { label: "Activa", tone: "success" },
  suspended: { label: "Suspensa", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const SUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  trialing: { label: "Experimental", tone: "info" },
  active: { label: "Activa", tone: "success" },
  past_due: { label: "Em atraso", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendente", tone: "warning" },
  approved: { label: "Aprovado", tone: "success" },
  rejected: { label: "Recusado", tone: "neutral" },
};

export function companyStatus(s: string) {
  return COMPANY_STATUS[s] ?? { label: s, tone: "neutral" as Tone };
}

/* ------------------------------------------------------------------ */
/* Acessos                                                             */
/* ------------------------------------------------------------------ */

/** Mesmo formato aceite por ps_set_access: letras, números, ponto, hífen, + ou um email. */
export const LOGIN_PATTERN = /^[a-z0-9._@+-]{3,}$/;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Palavra-passe aleatória legível (sem 0/O, 1/l/I). */
export function generatePassword(length = 12) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  // Garante pelo menos um dígito.
  return /\d/.test(out) ? out : `${out.slice(0, -1)}${(bytes[0] % 8) + 2}`;
}

/** Sugestão de utilizador a partir do nome da empresa (ex.: "Mozal Lda" → "admin.mozal"). */
export function suggestLogin(companyName: string) {
  const slug = companyName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(lda|sa|limitada|ltd|e\.?i)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
  return slug ? `admin.${slug}` : "";
}
