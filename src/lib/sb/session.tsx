"use client";

import type { Session } from "@supabase/supabase-js";
import * as React from "react";
import { errorMessage, rpc, sb } from "./client";

export type Membership = {
  companyId: string;
  companyName: string;
  companyStatus: string;
  timezone: string;
  currency: string;
  settings: CompanySettings;
  role: RoleCode;
  roleName: string;
  employeeId: string | null;
  permissions: string[];
  teamDepartments: string[];
  /** Funções avançadas ligadas a este gerente (ex.: "oficina"). */
  modules?: string[];
  /** Funções avançadas ligadas a algum gerente da empresa. */
  companyModules?: string[];
};

export type CompanySettings = {
  devicePolicy?: "off" | "warn" | "require";
  absenceFlow?: "hr_only" | "supervisor_then_hr";
  duplicateWindowMinutes?: number;
  payrollDailyDivisor?: number;
  requireMfaForAdmins?: boolean;
};

export type RoleCode = "owner" | "admin" | "hr" | "finance" | "supervisor" | "manager" | "employee";

/** Papéis que entram no painel da empresa (o gerente e o colaborador usam o painel pessoal). */
export const isCompanyStaff = (role: RoleCode | undefined) => !!role && role !== "employee" && role !== "manager";

export type Me = { id: string; login: string; name: string; isPlatformAdmin: boolean; memberships: Membership[] };

type SessionState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "mfa" }
  | { status: "error"; message: string }
  | { status: "ready"; me: Me; session: Session };

type Ctx = {
  state: SessionState;
  me: Me | null;
  company: Membership | null;
  setCompany: (id: string) => void;
  can: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = React.createContext<Ctx | null>(null);
const COMPANY_KEY = "pontosmart-empresa";

function readCompany() {
  try {
    return localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({ status: "loading" });
  const [companyId, setCompanyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: "anon" });
      return;
    }
    try {
      // Conta com verificação em dois passos: pedir o código antes de abrir.
      const { data: aal } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setState({ status: "mfa" });
        return;
      }
      const me = await rpc<Me | null>("ps_me");
      if (!me) {
        // Conta do Auth sem ficha no Horbit.
        await sb().auth.signOut();
        setState({ status: "error", message: "Esta conta não está registada no Horbit." });
        return;
      }
      setState({ status: "ready", me, session });
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
  }, []);

  React.useEffect(() => {
    setCompanyId(readCompany());
    const client = sb();
    client.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setState({ status: "anon" });
      else if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "MFA_CHALLENGE_VERIFIED") void load(session);
      else if (event === "TOKEN_REFRESHED" && session)
        setState((s) => (s.status === "ready" ? { ...s, session } : s));
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const me = state.status === "ready" ? state.me : null;
  const company = React.useMemo(() => {
    if (!me?.memberships.length) return null;
    return me.memberships.find((m) => m.companyId === companyId) ?? me.memberships[0];
  }, [me, companyId]);

  const value = React.useMemo<Ctx>(
    () => ({
      state,
      me,
      company,
      setCompany: (id) => {
        setCompanyId(id);
        try {
          localStorage.setItem(COMPANY_KEY, id);
        } catch {}
      },
      can: (...perms) => !!company && perms.some((p) => company.permissions.includes(p)),
      refresh: async () => {
        const { data } = await sb().auth.getSession();
        await load(data.session);
      },
      signOut: async () => {
        await sb().auth.signOut();
        setState({ status: "anon" });
      },
    }),
    [state, me, company, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession fora do SessionProvider");
  return ctx;
}

/** Empresa activa — só usar dentro das áreas protegidas (o guarda garante que existe). */
export function useCompany() {
  const { company, can, me } = useSession();
  if (!company || !me) throw new Error("Sem empresa activa");
  return { company, can, me, companyId: company.companyId, tz: company.timezone };
}

/** Página inicial adequada ao utilizador. */
export function homeFor(me: Me, company: Membership | null): string {
  if (company && isCompanyStaff(company.role)) return "/empresa/";
  if (company?.employeeId) return "/app/";
  if (me.isPlatformAdmin) return "/admin/";
  return "/sem-acesso/";
}
