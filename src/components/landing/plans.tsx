"use client";

import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/sb/client";
import { cn } from "@/lib/utils";

type Plan = { code: string; name: string; price_monthly: string | number; currency: string; max_employees: number; modules: string[] };

const MODULES: Record<string, string> = {
  ponto: "Marcação por QR e localização",
  assiduidade: "Assiduidade e horários",
  justificacoes: "Justificações com anexos",
  salarios: "Processamento salarial e recibos",
  relatorios: "Relatórios em Excel",
  ia: "Assistente de IA",
  multi_filial: "Várias filiais",
};

// Usado enquanto os planos carregam do Supabase (e se a ligação falhar).
const FALLBACK: Plan[] = [
  { code: "essencial", name: "Essencial", price_monthly: 2500, currency: "MZN", max_employees: 25, modules: ["ponto", "assiduidade", "justificacoes"] },
  { code: "profissional", name: "Profissional", price_monthly: 7500, currency: "MZN", max_employees: 100, modules: ["ponto", "assiduidade", "justificacoes", "salarios", "relatorios"] },
  { code: "empresarial", name: "Empresarial", price_monthly: 22000, currency: "MZN", max_employees: 500, modules: ["ponto", "assiduidade", "justificacoes", "salarios", "relatorios", "ia", "multi_filial"] },
];

/** Preço inteiro com espaço de milhares (2 500, 22 000). */
const price = (v: string | number) => Math.round(Number(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

export function Plans() {
  const [plans, setPlans] = React.useState<Plan[]>(FALLBACK);
  React.useEffect(() => {
    sb()
      .from("subscription_plans")
      .select("code,name,price_monthly,currency,max_employees,modules")
      .eq("active", true)
      .order("price_monthly")
      .then(({ data }) => {
        if (data?.length) setPlans(data as Plan[]);
      });
  }, []);

  const featured = plans.length >= 3 ? plans[1].code : null;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => {
        const highlight = p.code === featured;
        return (
          <div
            key={p.code}
            className={cn(
              "flex flex-col rounded-2xl border p-6",
              highlight ? "border-[#15131f] bg-[#15131f] text-white" : "border-[#e7e3f1] bg-white",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-[20px] font-semibold">{p.name}</h3>
              <span className={cn("text-[13px]", highlight ? "text-white/70" : "text-[#6b6e7f]")}>até {p.max_employees} pessoas</span>
            </div>
            <p className="mt-5">
              <span className="font-display text-[34px] font-semibold tracking-tight tabular">{price(p.price_monthly)} {p.currency}</span>
              <span className={cn("ml-1 text-[13px]", highlight ? "text-white/70" : "text-[#6b6e7f]")}>por mês</span>
            </p>
            <ul className={cn("mt-6 flex-1 space-y-2.5 text-[14px]", highlight ? "text-white/85" : "text-[#3a3d4f]")}>
              {(p.modules ?? []).map((m) => (
                <li key={m} className="flex gap-2.5">
                  <svg viewBox="0 0 16 16" className={cn("mt-1 size-3.5 shrink-0", highlight ? "text-[#b9a4f8]" : "text-primary")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                  {MODULES[m] ?? m}
                </li>
              ))}
            </ul>
            <Button asChild size="lg" variant={highlight ? "primary" : "outline"} className="mt-7 w-full">
              <Link href={`/registo/?plano=${p.code}`}>Pedir o plano {p.name}</Link>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
