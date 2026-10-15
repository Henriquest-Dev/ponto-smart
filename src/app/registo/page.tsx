import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { getContext } from "@/lib/auth/context";
import { publicPlans } from "@/lib/queries/public";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Pedir conta" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ plano?: string }> }) {
  const [{ plano }, ctx, plans] = await Promise.all([searchParams, getContext().catch(() => null), publicPlans()]);
  const selected = plans.find((p) => p.code === plano)?.id ?? plans[1]?.id ?? plans[0]?.id ?? "";
  return (
    <div className="min-h-dvh bg-surface">
      <SiteHeader loggedIn={!!ctx} />
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:py-16">
        <div>
          <p className="text-[13px] font-medium text-primary">Pedir conta</p>
          <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight">Crie a conta da sua empresa</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            A equipa PontoSmart valida o pedido e cria a conta da empresa com as credenciais do proprietário.
            A partir daí, é a sua empresa que cria as credenciais de acesso dos colaboradores, RH, financeiro e supervisores.
          </p>
          <ol className="mt-8 space-y-4 text-[14px]">
            {[
              ["Envie o pedido", "Dados da empresa e do responsável."],
              ["Validação", "Confirmamos o plano e o período experimental."],
              ["Credenciais do proprietário", "Recebe o acesso ao painel da empresa."],
              ["Credenciais da equipa", "No painel, crie as contas dos colaboradores."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary">{i + 1}</span>
                <span><span className="block font-medium">{t}</span><span className="text-[13px] text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl border border-border bg-background p-5 shadow-panel sm:p-8">
          <RequestForm plans={plans.map((p) => ({ id: p.id, label: `${p.name} — até ${p.maxEmployees} colaboradores` }))} selected={selected} />
        </div>
      </main>
    </div>
  );
}
