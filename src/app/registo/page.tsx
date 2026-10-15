import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Pedir conta" };

const STEPS = [
  ["Envie o pedido", "Dados da empresa e do responsável."],
  ["Validação", "Confirmamos o plano e o período experimental."],
  ["Acesso do responsável", "Recebe o utilizador e a palavra-passe do painel da empresa."],
  ["Acessos da equipa", "No painel, crie os acessos dos colaboradores, RH, financeiro e supervisores."],
];

export default function RegisterPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="PontoSmart — início">
            <Logo />
          </Link>
          <div className="ml-auto">
            <Button variant="ghost" asChild>
              <Link href="/login/">Entrar</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:py-16">
        <div>
          <p className="text-[13px] font-medium text-primary">Pedir conta</p>
          <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight sm:text-[30px]">Crie a conta da sua empresa</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            A equipa PontoSmart valida o pedido e cria a conta da empresa com o acesso do responsável. A partir daí, é a sua
            empresa que cria os acessos dos colaboradores, RH, financeiro e supervisores.
          </p>
          <ol className="mt-8 space-y-4 text-[14px]">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary">{i + 1}</span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="text-[13px] text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl border border-border bg-background p-5 shadow-panel sm:p-8">
          <Suspense fallback={<Skeleton className="h-[520px]" />}>
            <RequestForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
