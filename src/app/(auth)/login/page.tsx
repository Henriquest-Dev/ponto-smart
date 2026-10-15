import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Picture } from "@/components/brand/media";
import { Wordmark } from "@/components/shell/logo";
import { FirstVisit } from "./first-visit";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(440px,1fr)_1.1fr]">
      <FirstVisit />
      {/* Formulário */}
      <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-16 lg:py-10">
        <Link href="/" aria-label="Horbit, página inicial" className="w-fit">
          <Wordmark className="h-7 lg:h-8" />
        </Link>
        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[400px]">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="text-[13px] text-muted">
          Ainda sem acesso?{" "}
          <Link href="/registo/" className="font-bold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            Pedir conta para a empresa
          </Link>
        </p>
      </section>

      {/* Apresentação (só em ecrãs largos) */}
      <aside className="hidden flex-col justify-center bg-[#16131f] px-14 py-12 text-white lg:flex">
        <Picture src="/onboarding/1.webp" alt="" width={1080} height={1080} priority className="mx-auto aspect-square h-auto w-full max-w-[520px] rounded-2xl bg-primary" />
        <div className="mx-auto mt-10 w-full max-w-[520px]">
          <p className="text-[24px] leading-[1.2] font-bold tracking-[-0.02em]">Cada marcação confirma o código, a hora e o local.</p>
          <p className="mt-3 text-[14px] leading-relaxed text-white/60">
            O telemóvel lê o QR da estação e o Horbit verifica se a pessoa está dentro do perímetro antes de registar.{" "}
            <Link href="/comecar/" className="font-bold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Ver a apresentação
            </Link>
          </p>
        </div>
      </aside>
    </div>
  );
}
