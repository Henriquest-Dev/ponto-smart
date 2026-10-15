import type { Metadata } from "next";
import Link from "next/link";
import { OrbitScene } from "@/components/brand/orbit-scene";
import { Plans } from "@/components/landing/plans";
import { SiteHeader } from "@/components/landing/site-header";
import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Horbit — ponto, assiduidade e salários" },
  description:
    "Os colaboradores marcam o ponto no telemóvel, com QR Code que muda e localização confirmada. Assiduidade, justificações e recibos num só sítio. Para empresas em Moçambique.",
};

const STEPS = [
  {
    who: "Horbit",
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
    text: "Abre o Horbit no telemóvel e lê o QR do ecrã da recepção. O sistema confirma o código, a hora e se está dentro do local.",
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
    <div className="min-h-dvh bg-canvas text-foreground">
      <SiteHeader />

      <main>
        {/* Hero: texto à esquerda, palco 2.5D à direita */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:pt-16 lg:pb-24">
          <div>
            <h1 className="text-[40px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[64px]">
              O ponto da equipa, marcado no telemóvel e no sítio certo.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted">
              Sem relógio de ponto nem folhas para assinar. O colaborador lê o QR da recepção, o Horbit confirma a hora e a localização, e o
              RH vê a assiduidade, as faltas e os salários do mês num só lugar.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/registo/">Pedir conta para a empresa</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login/">Já tenho acesso</Link>
              </Button>
            </div>
            <p className="mt-6 flex items-center gap-2.5 text-[13.5px] font-medium text-muted">
              <span className="stem text-primary" aria-hidden />
              Feito para Moçambique: meticais, horário de Maputo e português.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-[36px] bg-[#1a1530] p-6 sm:p-12">
            <OrbitScene />
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20 rounded-t-[40px] bg-background">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="max-w-2xl">
              <h2 className="text-[32px] leading-tight font-extrabold tracking-[-0.025em] sm:text-[42px]">Como funciona</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                Os acessos são criados de cima para baixo. Ninguém se regista sozinho: cada conta tem um responsável.
              </p>
            </div>

            <ol className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <div className="flex items-center gap-1.5" aria-hidden>
                    {STEPS.map((_, j) => (
                      <span key={j} className={j <= i ? "h-2 w-8 rounded-full bg-primary" : "h-2 w-8 rounded-full bg-surface-2"} />
                    ))}
                  </div>
                  <p className="mt-5 text-[13px] font-bold text-primary">
                    Passo {i + 1}, {s.who}
                  </p>
                  <h3 className="mt-1.5 text-[19px] leading-snug font-extrabold">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>

            <div className="mt-16 grid gap-8 rounded-[32px] bg-canvas p-6 sm:p-10 lg:grid-cols-[0.9fr_1.4fr] lg:items-center">
              <div>
                <h3 className="text-[26px] leading-tight font-extrabold tracking-[-0.02em]">Onde se criam os acessos</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">
                  Se é colaborador e ainda não tem utilizador, peça-o ao RH da sua empresa. Se é responsável de uma empresa, comece por pedir a conta.
                </p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Conta da empresa", "Criada pela Horbit, no painel de administração da plataforma."],
                  ["Acessos da equipa", "Criados pela empresa, em Colaboradores, com papel e palavra-passe."],
                  ["Palavra-passe esquecida", "Redefinida pelo responsável da empresa, na ficha do colaborador."],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[22px] bg-background p-5">
                    <dt className="flex items-center gap-2 text-[15px] font-extrabold">
                      <span className="stem text-primary" aria-hidden />
                      {k}
                    </dt>
                    <dd className="mt-2 text-[13.5px] leading-relaxed text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Para cada papel */}
        <section className="bg-background">
          <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
            <h2 className="max-w-2xl text-[32px] leading-tight font-extrabold tracking-[-0.025em] sm:text-[42px]">
              Cada pessoa vê o que precisa para o seu trabalho
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x-2 md:divide-border">
              {ROLES.map((r) => (
                <div key={r.title} className="md:px-8 md:first:pl-0 md:last:pr-0">
                  <h3 className="text-[19px] font-extrabold">{r.title}</h3>
                  <ul className="mt-5 space-y-3.5">
                    {r.lines.map((l) => (
                      <li key={l} className="flex gap-3 text-[14.5px] leading-relaxed text-[#3d3854]">
                        <span className="stem mt-[5px] h-3 text-primary" aria-hidden />
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
        <section id="precos" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="max-w-xl">
              <h2 className="text-[32px] leading-tight font-extrabold tracking-[-0.025em] sm:text-[42px]">Preços em meticais</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                Mensalidade por empresa, sem custo por marcação. Os primeiros 30 dias servem para configurar e experimentar.
              </p>
            </div>
            <div className="mt-10">
              <Plans />
            </div>
          </div>
        </section>

        {/* Confiança */}
        <section id="confianca" className="scroll-mt-20 bg-background">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-24">
            <div>
              <h2 className="text-[32px] leading-tight font-extrabold tracking-[-0.025em] sm:text-[42px]">Regras claras, sem surpresas</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                O Horbit regista factos e ajuda a decidir. Faltas, revisões e salários são sempre decididos por uma pessoa.
              </p>
            </div>
            <dl className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {TRUST.map(([t, d]) => (
                <div key={t} className="border-t-[4px] border-primary pt-4">
                  <dt className="text-[17px] font-extrabold">{t}</dt>
                  <dd className="mt-2 text-[14.5px] leading-relaxed text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Chamada final */}
        <section className="bg-background px-4 pb-16 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 rounded-[36px] bg-primary px-6 py-12 text-white sm:px-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="text-[30px] leading-tight font-extrabold tracking-[-0.02em] sm:text-[38px]">Comece pela conta da empresa</h2>
              <p className="mt-3 text-[15.5px] leading-relaxed text-white/80">
                Envie o pedido com os dados da empresa. Respondemos com o acesso do responsável, que depois cria os acessos da equipa.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild className="bg-white text-primary hover:bg-white/90">
                <Link href="/registo/">Pedir conta</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-white/40 bg-transparent text-white hover:border-white">
                <Link href="/login/">Entrar</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-border px-4 py-8 text-[13.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark className="h-6" />
          <p>Horbit, Maputo, Moçambique</p>
          <nav className="flex gap-6 font-bold" aria-label="Rodapé">
            <Link href="/login/" className="hover:text-foreground">Entrar</Link>
            <Link href="/registo/" className="hover:text-foreground">Pedir conta</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
