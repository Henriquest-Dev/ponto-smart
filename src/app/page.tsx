import type { Metadata } from "next";
import Link from "next/link";
import { Picture } from "@/components/brand/media";
import { SiteHeader } from "@/components/landing/site-header";
import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Horbit — guia prático" },
  description:
    "Guia prático do Horbit, página a página: pedir a conta, configurar o local, criar a equipa, marcar o ponto com QR Code, justificar faltas, fechar salários e falar com o assistente.",
};

type Chapter = {
  id: string;
  who: string;
  title: string;
  page: string;
  steps: string[];
  /** Captura principal (1600×1000) e detalhe sobreposto (640×800), em public/guia/. */
  main: string;
  detail?: string;
  alt: string;
};

const CHAPTERS: Chapter[] = [
  {
    id: "pedir-conta",
    who: "Responsável da empresa",
    title: "Pedir a conta da empresa",
    page: "Pedir conta",
    steps: [
      "Abra Pedir conta e escreva o nome da empresa, o NUIT, a cidade e quantas pessoas trabalham consigo.",
      "Indique o responsável: nome, email e telefone. É esta pessoa que vai receber o primeiro acesso.",
      "Envie o pedido. A equipa Horbit confirma os dados e responde pelo email ou telefone indicados.",
    ],
    main: "/guia/01-pedir-conta.webp",
    alt: "Formulário de pedido de conta com os dados da empresa e do responsável",
  },
  {
    id: "aprovar",
    who: "Super Admin",
    title: "Aprovar o pedido e entregar o acesso",
    page: "Plataforma › Pedidos de conta",
    steps: [
      "Em Pedidos de conta aparecem os pedidos novos, com os contactos e o número de colaboradores.",
      "Aprovar cria a empresa, um horário base de 08:00 às 17:00 e o acesso do responsável.",
      "No fim, o Horbit mostra o utilizador e a palavra-passe para copiar e entregar ao responsável.",
    ],
    main: "/guia/02-aprovar.webp",
    detail: "/guia/02-aprovar-detalhe.webp",
    alt: "Lista de pedidos de conta no painel do Super Admin",
  },
  {
    id: "local",
    who: "Responsável ou RH",
    title: "Configurar o local e a estação",
    page: "Painel › Locais e estações",
    steps: [
      "Crie o local de trabalho com as coordenadas da entrada e o raio permitido, por exemplo 80 metros.",
      "Dentro do local, crie a estação: é o ecrã da recepção que mostra o QR Code.",
      "Escolha QR dinâmico: o código muda a cada 30 segundos e uma fotografia dele deixa de servir.",
    ],
    main: "/guia/03-locais.webp",
    alt: "Página de locais e estações com o perímetro e a estação da recepção",
  },
  {
    id: "equipa",
    who: "Responsável ou RH",
    title: "Criar os acessos da equipa",
    page: "Painel › Colaboradores",
    steps: [
      "Em Novo colaborador escreva o nome, o número, o departamento, o horário e o salário base.",
      "Defina o utilizador e a palavra-passe, e o papel: colaborador, supervisor, RH ou financeiro.",
      "Entregue o acesso à pessoa. Se esquecer a palavra-passe, redefine-a na ficha do colaborador.",
    ],
    main: "/guia/04-colaboradores.webp",
    detail: "/guia/04-novo-colaborador.webp",
    alt: "Lista de colaboradores por departamento e o formulário de novo colaborador",
  },
  {
    id: "estacao",
    who: "Recepção",
    title: "Pôr a estação na recepção",
    page: "Locais e estações › Abrir estação",
    steps: [
      "Abra a estação num tablet ou computador na entrada, com o ecrã sempre ligado.",
      "O ecrã mostra o QR Code, a hora e o tempo até o código mudar.",
      "Não é preciso ninguém a vigiar: cada leitura fica registada com a hora do servidor.",
    ],
    main: "/guia/05-estacao.webp",
    alt: "Ecrã da estação com o QR Code dinâmico e o relógio",
  },
  {
    id: "marcar",
    who: "Colaborador",
    title: "Marcar o ponto no telemóvel",
    page: "Aplicação › Marcar",
    steps: [
      "Entre com o utilizador que recebeu da empresa e toque em Marcar.",
      "Aponte a câmara ao QR da recepção. O telemóvel pede a localização só nesse momento.",
      "O Horbit confirma o código, a hora e o local, e mostra Entrada registada. À saída faz o mesmo.",
    ],
    main: "/guia/06-marcar.webp",
    detail: "/guia/06-marcar-detalhe.webp",
    alt: "Ecrã inicial do colaborador com o tempo trabalhado e o botão de marcar",
  },
  {
    id: "justificar",
    who: "Colaborador, supervisor e RH",
    title: "Justificar uma falta",
    page: "Aplicação › Faltas  e  Painel › Justificações",
    steps: [
      "O colaborador escolhe o dia, o motivo e junta uma fotografia do atestado ou documento.",
      "O pedido chega ao supervisor e ao RH, que aprovam ou recusam, sempre com o fundamento.",
      "Uma falta aprovada passa a justificada na assiduidade e não conta como desconto.",
    ],
    main: "/guia/07-justificacoes.webp",
    detail: "/guia/07-justificar-detalhe.webp",
    alt: "Justificações por decidir no painel e o pedido feito no telemóvel",
  },
  {
    id: "acompanhar",
    who: "RH e supervisores",
    title: "Acompanhar a assiduidade",
    page: "Painel  e  Assiduidade",
    steps: [
      "O Painel mostra quem está presente, quem chegou atrasado e quem ainda não marcou.",
      "Marcações com GPS fraco ou no limite do local ficam em Revisão para uma pessoa decidir.",
      "Correcções de horas pedem sempre um motivo e ficam registadas na Auditoria.",
    ],
    main: "/guia/08-painel.webp",
    alt: "Painel da empresa com a presença de hoje e a equipa",
  },
  {
    id: "salarios",
    who: "Responsável, RH e financeiro",
    title: "Fechar o mês e emitir os recibos",
    page: "Painel › Salários",
    steps: [
      "Feche a assiduidade do mês e gere o pré-processamento a partir das horas e faltas registadas.",
      "Outra pessoa aprova os valores: quem prepara não aprova.",
      "Emita os recibos em PDF e registe os pagamentos. Cada colaborador vê o seu recibo no telemóvel.",
    ],
    main: "/guia/09-salarios.webp",
    detail: "/guia/09-recibos.webp",
    alt: "Processamento salarial com os totais do mês e o recibo no telemóvel",
  },
  {
    id: "assistente",
    who: "Gestão e Super Admin",
    title: "Conversar com o assistente",
    page: "Painel › Assistente",
    steps: [
      "Pergunte em português, como numa conversa: quem chegou atrasado, que faltas estão por decidir.",
      "O assistente usa só os dados que o seu papel pode ver, e explica como usar cada página.",
      "Não aprova, não paga e não altera nada: as decisões ficam sempre com uma pessoa.",
    ],
    main: "/guia/10-assistente.webp",
    alt: "Conversa com o assistente sobre os atrasos dos últimos 30 dias",
  },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader />

      <main>
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-4 pt-12 pb-12 sm:px-6 lg:pt-20 lg:pb-16">
            <h1 className="max-w-3xl text-[36px] leading-[1.05] font-bold tracking-[-0.02em] text-balance sm:text-[52px]">
              Guia prático do Horbit
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
              Do pedido de conta ao recibo de vencimento, página a página. Cada passo mostra o ecrã real e quem o usa: o Super Admin, a
              empresa, o RH, o financeiro e o colaborador.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/registo/">Pedir conta para a empresa</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login/">Entrar</Link>
              </Button>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:grid lg:grid-cols-[220px_1fr] lg:gap-14">
          {/* Índice */}
          <nav aria-label="Capítulos do guia" className="hidden lg:block">
            <ol className="sticky top-20 space-y-0.5 py-12 text-[13.5px]">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="flex gap-2.5 rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
                    <span className="w-5 shrink-0 text-right font-bold tabular">{i + 1}</span>
                    <span>{c.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <ol className="divide-y divide-border">
            {CHAPTERS.map((c, i) => (
              <li key={c.id} id={c.id} className="scroll-mt-16 py-12 lg:py-16">
                <p className="text-[13px] font-bold text-muted">
                  Passo {i + 1} de {CHAPTERS.length}, {c.who}
                </p>
                <h2 className="mt-1.5 text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[32px]">{c.title}</h2>
                <p className="mt-2 text-[13.5px] text-muted">
                  Onde: <span className="font-bold text-foreground">{c.page}</span>
                </p>

                <figure className={c.detail ? "relative mt-8 pb-10 sm:pr-24 sm:pb-16" : "mt-8"}>
                  <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-34px_rgb(22_19_31/0.45)]">
                    <Picture src={c.main} alt={c.alt} width={1600} height={1000} className="block h-auto w-full" />
                  </div>
                  {c.detail ? (
                    <div className="absolute right-0 bottom-0 w-[38%] max-w-[260px] overflow-hidden rounded-xl border border-border bg-background shadow-[0_28px_60px_-24px_rgb(22_19_31/0.55)] sm:w-[30%]">
                      <Picture src={c.detail} alt="" width={640} height={800} className="block h-auto w-full" />
                    </div>
                  ) : null}
                </figure>

                <ol className="mt-8 grid gap-5 md:grid-cols-3">
                  {c.steps.map((s, j) => (
                    <li key={s} className="border-t border-border-strong pt-4">
                      <span className="text-[13px] font-bold text-muted tabular">{j + 1}.</span>
                      <p className="mt-1 text-[15px] leading-relaxed">{s}</p>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[30px]">Pronto para começar?</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                A empresa pede a conta, o Super Admin aprova e o responsável cria os acessos da equipa.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/registo/">Pedir conta</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login/">Entrar</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark className="h-6" />
          <p>Horbit, Maputo, Moçambique</p>
          <nav className="flex gap-6 font-bold" aria-label="Rodapé">
            <Link href="/comecar/" className="hover:text-foreground">Apresentação</Link>
            <Link href="/login/" className="hover:text-foreground">Entrar</Link>
            <Link href="/registo/" className="hover:text-foreground">Pedir conta</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
