import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OrbitScene } from "@/components/brand/orbit-scene";
import { Wordmark } from "@/components/shell/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(420px,0.9fr)_1.1fr] lg:gap-3 lg:p-3">
      {/* Palco animado */}
      <section className="relative overflow-hidden bg-[#1a1530] text-white lg:order-2 lg:rounded-[32px]">
        <div className="flex items-center justify-between px-5 pt-5 lg:absolute lg:inset-x-0 lg:top-0 lg:px-10 lg:pt-9">
          <Link href="/" aria-label="Horbit, página inicial" className="lg:hidden">
            <Wordmark className="h-6" color="#ffffff" />
          </Link>
          <p className="hidden text-[13px] font-bold text-white/60 lg:block">Ponto, assiduidade e salários</p>
        </div>
        <div className="mx-auto h-[300px] w-full max-w-[420px] sm:h-[360px] lg:absolute lg:inset-0 lg:m-auto lg:h-auto lg:max-w-none lg:px-16 lg:py-24">
          <OrbitScene className="h-full" />
        </div>
        <div className="hidden lg:absolute lg:inset-x-0 lg:bottom-0 lg:block lg:px-10 lg:pb-10">
          <p className="max-w-md text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em]">
            Cada marcação confirma o código, a hora e o local.
          </p>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/60">
            O telemóvel lê o QR da estação e o Horbit verifica se a pessoa está dentro do perímetro antes de registar.
          </p>
        </div>
      </section>

      {/* Formulário */}
      <section className="relative z-10 -mt-8 flex flex-col rounded-t-[32px] bg-background px-5 pt-8 pb-8 sm:px-10 lg:order-1 lg:mt-0 lg:rounded-[32px] lg:px-14 lg:py-12">
        <Link href="/" aria-label="Horbit, página inicial" className="hidden w-fit lg:block">
          <Wordmark className="h-8" />
        </Link>
        <div className="flex flex-1 items-center py-2 lg:py-10">
          <div className="mx-auto w-full max-w-[400px]">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="text-center text-[12.5px] text-muted lg:text-left">
          Ainda sem acesso?{" "}
          <Link href="/registo/" className="font-bold text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary">
            Pedir conta para a empresa
          </Link>
        </p>
      </section>
    </div>
  );
}
