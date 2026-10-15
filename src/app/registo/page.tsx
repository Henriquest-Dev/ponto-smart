import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
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
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(480px,1.15fr)_0.85fr] lg:gap-3 lg:p-3">
      {/* Formulário */}
      <section className="flex flex-col bg-background px-5 pt-6 pb-8 sm:px-10 lg:rounded-[32px] lg:px-14 lg:py-12">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Horbit, página inicial" className="w-fit">
            <Wordmark className="h-7 lg:h-8" />
          </Link>
          <Link
            href="/login/"
            className="text-[13.5px] font-bold text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary"
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
      <aside className="bg-[#1a1530] px-5 py-10 text-white sm:px-10 lg:sticky lg:top-3 lg:flex lg:h-[calc(100dvh-24px)] lg:flex-col lg:justify-between lg:rounded-[32px] lg:px-12 lg:py-12">
        <p className="text-[13px] font-bold text-white/60">Ponto, assiduidade e salários</p>
        <div className="mt-8 lg:mt-0">
          <h2 className="max-w-sm text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em]">
            A sua empresa no Horbit em quatro passos.
          </h2>
          <ol className="mt-8 space-y-6">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[32px_1fr] gap-3">
                <span className="text-[22px] leading-none font-extrabold text-primary-soft tabular">{i + 1}</span>
                <span>
                  <span className="block text-[15px] font-extrabold">{t}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-relaxed text-white/60">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-10 max-w-sm text-[13px] leading-relaxed text-white/50 lg:mt-0">
          A equipa Horbit cria a conta e o acesso do responsável. Depois disso, a gestão de utilizadores fica com a sua empresa.
        </p>
      </aside>
    </div>
  );
}
