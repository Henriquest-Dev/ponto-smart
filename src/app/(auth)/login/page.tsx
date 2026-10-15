import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext, homeFor } from "@/lib/auth/context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sessão" };

const DEMO = [
  ["Colaborador", "colaborador@mahotas.example"],
  ["Supervisor", "supervisor@mahotas.example"],
  ["RH", "rh@mahotas.example"],
  ["Financeiro", "financeiro@mahotas.example"],
  ["Proprietário", "dono@mahotas.example"],
  ["Super Admin", "admin@pontosmart.co.mz"],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const ctx = await getContext();
  if (ctx) redirect(homeFor(ctx));
  const showDemo = process.env.DEMO_MODE !== "false";

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">Iniciar sessão</h1>
      <p className="mt-1.5 text-sm text-muted">Use as credenciais fornecidas pela sua empresa.</p>
      <LoginForm next={next} />
      {showDemo ? (
        <details className="mt-8 rounded-lg border border-border bg-surface/60 px-4 py-3 text-[13px]">
          <summary className="cursor-pointer font-medium">Contas de demonstração</summary>
          <p className="mt-2 text-xs text-muted">
            Palavra-passe: <span className="font-mono text-foreground">PontoSmart2026</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {DEMO.map(([role, email]) => (
              <li key={email} className="flex items-center justify-between gap-3">
                <span className="text-muted">{role}</span>
                <span className="truncate font-mono text-xs">{email}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
