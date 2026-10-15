import "@fontsource-variable/bricolage-grotesque";
import type { Metadata } from "next";
import Link from "next/link";
import { ClockScene } from "@/components/landing/clock-scene";
import { Plans } from "@/components/landing/plans";
import { SiteHeader } from "@/components/landing/site-header";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "PontoSmart — ponto, assiduidade e salários" },
  description:
    "Os colaboradores marcam o ponto no telemóvel, com QR Code que muda e localização confirmada. Assiduidade, justificações e recibos num só sítio. Para empresas em Moçambique.",
};

const STEPS = [
  {
    who: "PontoSmart",
    title: "Criamos a conta da empresa",
    text: "Peça a conta nesta página. Depois de validarmos os dados, o responsável da empresa recebe o utilizador e a palavra-passe.",
  },
  {
    who: "Empresa",
    title: "A empresa cria os acessos da equipa",
    text: "O responsável ou o RH regista cada colaborador e define o utilizador, a palavra-passe e o papel: colaborador, supervisor, RH ou financeiro.",
  },
  {
    who: "Colaborador",
    title: "O colaborador marca o ponto",
    text: "Abre o PontoSmart no telemóvel e lê o QR do ecrã da recepção. O sistema confirma o código, a hora e se está dentro do local.",
  },
  {
    who: "RH e financeiro",
    title: "O mês fecha sem papelada",
    text: "Faltas justificadas com anexos, assiduidade revista, salários calculados e aprovados por outra pessoa, recibos em PDF.",
  },
];

const ROLES = [
  {
    title: "Para quem marca",
    lines: [
      "Entrada, intervalo e saída em segundos, no próprio telemóvel.",
      "Histórico do mês e atrasos sempre visíveis.",
      "Justificação de faltas com fotografia do atestado.",
      "Recibos de vencimento disponíveis para descarregar.",
    ],
  },
  {
    title: "Para RH e supervisores",
    lines: [
      "Quem está, quem chegou atrasado e quem falta, por departamento.",
      "Marcações duvidosas ficam em revisão, nunca são apagadas.",
      "Aprovação de justificações em dois passos, com fundamento.",
      "Relatórios em Excel e registo de todas as alterações.",
    ],
  },
  {
    title: "Para o financeiro",
    lines: [
      "Processamento salarial a partir da assiduidade fechada.",
      "Quem prepara não aprova: a aprovação é de outra pessoa.",
      "Recibos emitidos e pagamentos registados por colaborador.",
      "Valores em meticais, sem taxas legais inventadas.",
    ],
  },
];

const TRUST = [
  ["Cada empresa só vê os seus dados", "As regras de acesso estão na própria base de dados: um colaborador vê o que é dele, um supervisor vê a equipa."],
  ["GPS impreciso não é fraude", "Quando o sinal é fraco ou está no limite do local, a marcação fica em revisão para o RH decidir."],
  ["Um QR fotografado não serve", "O código do ecrã muda a cada 30 segundos e só é aceite uma vez dentro do prazo."],
  ["Tudo fica registado", "Correcções, aprovações e alterações salariais guardam quem fez, quando e o valor anterior."],
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-[#f6f4fb] text-[#15131f]">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-20 lg:pb-24">
          <div>
            <h1 className="font-display text-[38px] leading-[1.04] font-semibold tracking-[-0.02em] text-balance sm:text-[54px] lg:text-[60px]">
              O ponto da equipa, marcado no telemóvel e no sítio certo.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[#55586a]">
              Sem relógio de ponto nem folhas para assinar. O colaborador lê o QR da recepção, o PontoSmart confirma a hora e a localização, e o
              RH vê a assiduidade, as faltas e os salários do mês num só lugar.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/registo/">Pedir conta para a empresa</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="bg-white">
                <Link href="/login/">Já tenho acesso</Link>
              </Button>
            </div>
            <p className="mt-5 text-[13px] text-[#6b6e7f]">Feito para empresas em Moçambique: meticais, horário de Maputo e português.</p>
          </div>
          <ClockScene />
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20 border-t border-[#e7e3f1] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="max-w-2xl">
              <h2 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.01em] sm:text-[38px]">Como funciona</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-[#55586a]">
                Os acessos são criados de cima para baixo. Ninguém se regista sozinho: cada conta tem um responsável.
              </p>
            </div>

            <ol className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative border-t-2 border-[#15131f] pt-5">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-[15px] font-semibold text-primary tabular">{i + 1}</span>
                    <span className="rounded-full bg-[#f1ecfd] px-2.5 py-0.5 text-[12px] font-medium text-[#5f32d6]">{s.who}</span>
                  </div>
                  <h3 className="mt-4 text-[17px] leading-snug font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#55586a]">{s.text}</p>
                </li>
              ))}
            </ol>

            <div className="mt-14 grid gap-6 rounded-2xl bg-[#f6f4fb] p-6 sm:p-8 lg:grid-cols-[1fr_1.4fr] lg:items-center">
              <div>
                <h3 className="font-display text-[22px] font-semibold">Onde se criam os acessos</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#55586a]">
                  Se é colaborador e ainda não tem utilizador, peça-o ao RH da sua empresa. Se é responsável de uma empresa, comece por pedir a conta.
                </p>
              </div>
              <dl className="grid gap-px overflow-hidden rounded-xl border border-[#e7e3f1] bg-[#e7e3f1] text-[14px] sm:grid-cols-3">
                {[
                  ["Conta da empresa", "Criada pela PontoSmart, no painel de administração da plataforma."],
                  ["Acessos da equipa", "Criados pela empresa, em Colaboradores, com papel e palavra-passe."],
                  ["Palavra-passe esquecida", "Redefinida pelo responsável da empresa, na ficha do colaborador."],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white p-4">
                    <dt className="font-semibold">{k}</dt>
                    <dd className="mt-1.5 text-[13px] leading-relaxed text-[#55586a]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Para cada papel */}
        <section className="border-t border-[#e7e3f1]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <h2 className="max-w-2xl font-display text-[30px] leading-tight font-semibold tracking-[-0.01em] sm:text-[38px]">
              Cada pessoa vê o que precisa para o seu trabalho
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-[#e1dcee]">
              {ROLES.map((r) => (
                <div key={r.title} className="md:px-8 md:first:pl-0 md:last:pr-0">
                  <h3 className="text-[17px] font-semibold">{r.title}</h3>
                  <ul className="mt-5 space-y-3.5">
                    {r.lines.map((l) => (
                      <li key={l} className="flex gap-3 text-[14px] leading-relaxed text-[#3a3d4f]">
                        <span className="mt-[9px] h-px w-3 shrink-0 bg-primary" aria-hidden />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Preços */}
        <section id="precos" className="scroll-mt-20 border-t border-[#e7e3f1] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div className="max-w-xl">
                <h2 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.01em] sm:text-[38px]">Preços em meticais</h2>
                <p className="mt-3 text-[16px] leading-relaxed text-[#55586a]">
                  Mensalidade por empresa, sem custo por marcação. Os primeiros 30 dias servem para configurar e experimentar.
                </p>
              </div>
            </div>
            <div className="mt-10">
              <Plans />
            </div>
          </div>
        </section>

        {/* Confiança */}
        <section id="confianca" className="scroll-mt-20 border-t border-[#e7e3f1]">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-24">
            <div>
              <h2 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.01em] sm:text-[38px]">Regras claras, sem surpresas</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-[#55586a]">
                O PontoSmart regista factos e ajuda a decidir. Faltas, revisões e salários são sempre decididos por uma pessoa.
              </p>
            </div>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {TRUST.map(([t, d]) => (
                <div key={t}>
                  <dt className="text-[16px] font-semibold">{t}</dt>
                  <dd className="mt-2 text-[14px] leading-relaxed text-[#55586a]">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Chamada final */}
        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl bg-[#15131f] px-6 py-12 text-white sm:px-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-[28px] leading-tight font-semibold sm:text-[34px]">Comece pela conta da empresa</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/70">
                Envie o pedido com os dados da empresa. Respondemos com o acesso do responsável, que depois cria os acessos da equipa.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/registo/">Pedir conta</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-white/25 bg-transparent text-white hover:bg-white/10">
                <Link href="/login/">Entrar</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#e7e3f1]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-[#6b6e7f] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>PontoSmart, Maputo, Moçambique</p>
          <nav className="flex gap-5" aria-label="Rodapé">
            <Link href="/login/" className="hover:text-foreground">Entrar</Link>
            <Link href="/registo/" className="hover:text-foreground">Pedir conta</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
