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
              "flex flex-col rounded-[28px] border-2 p-7",
              highlight ? "border-[#1a1530] bg-[#1a1530] text-white" : "border-border bg-white",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[22px] font-extrabold tracking-[-0.01em]">{p.name}</h3>
              <span className={cn("text-[13px]", highlight ? "text-white/70" : "text-muted")}>até {p.max_employees} pessoas</span>
            </div>
            <p className="mt-5">
              <span className="text-[38px] font-extrabold tracking-[-0.03em] tabular">{price(p.price_monthly)} {p.currency}</span>
              <span className={cn("ml-1 text-[13px]", highlight ? "text-white/70" : "text-muted")}>por mês</span>
            </p>
            <ul className={cn("mt-6 flex-1 space-y-2.5 text-[14px]", highlight ? "text-white/85" : "text-[#3d3854]")}>
              {(p.modules ?? []).map((m) => (
                <li key={m} className="flex gap-3 font-medium">
                  <span className={cn("stem mt-[5px] h-3", highlight ? "text-[#b7a6f7]" : "text-primary")} aria-hidden />
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
