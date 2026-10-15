import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Illustration } from "@/components/brand/media";
import { Wordmark } from "@/components/shell/logo";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Pedir conta para a empresa" };

const STEPS = [
  ["Envie o pedido", "Dados da empresa, do responsável e o plano pretendido."],
  ["Validamos os dados", "Confirmamos o plano e o período experimental."],
  ["Recebe o acesso do responsável", "Utilizador e palavra-passe do painel da empresa."],
  ["Cria os acessos da equipa", "Colaboradores, RH, financeiro e supervisores, a partir do painel."],
];

export default function RegisterPage() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(480px,1.15fr)_0.85fr]">
      {/* Formulário */}
      <section className="flex flex-col bg-background px-5 pt-6 pb-8 sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Horbit, página inicial" className="w-fit">
            <Wordmark className="h-7 lg:h-8" />
          </Link>
          <Link
            href="/login/"
            className="text-[13.5px] font-bold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
          >
            Já tenho conta
          </Link>
        </div>
        <div className="flex flex-1 py-8 lg:py-12">
          <div className="mx-auto w-full max-w-[560px]">
            <Suspense fallback={<div className="h-[720px]" />}>
              <RequestForm />
            </Suspense>
          </div>
        </div>
        <p className="text-center text-[12.5px] text-muted lg:text-left">
          Respondemos pelo email ou telefone indicados no pedido.
        </p>
      </section>

      {/* Como funciona */}
      <aside className="bg-[#efebfb] px-5 py-10 sm:px-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:px-12 lg:py-12">
        <Illustration name="company" className="mx-auto hidden h-auto max-h-[34vh] w-auto lg:block" />
        <div className="lg:mt-8">
          <h2 className="max-w-sm text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">A sua empresa no Horbit em quatro passos</h2>
          <ol className="mt-6 divide-y divide-[#dcd5f3] border-y border-[#dcd5f3]">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[28px_1fr] gap-3 py-3.5">
                <span className="text-[15px] font-bold text-[#5b5470] tabular">{i + 1}.</span>
                <span>
                  <span className="block text-[15px] font-bold">{t}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-relaxed text-[#5b5470]">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-8 max-w-sm text-[13px] leading-relaxed text-[#5b5470] lg:mt-auto">
          A equipa Horbit cria a conta e o acesso do responsável. Depois disso, a gestão de utilizadores fica com a sua empresa.
        </p>
      </aside>
    </div>
  );
}
