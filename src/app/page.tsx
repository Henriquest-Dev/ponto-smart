import {
  ArrowRight, BarChart3, Building2, CalendarCheck2, Check, FileCheck2, KeyRound, LocateFixed, MonitorSmartphone,
  QrCode, ReceiptText, ScrollText, ShieldCheck, UserPlus, Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GroupedBars, Legend, SmoothArea } from "@/components/charts/charts";
import { CHART_COLORS } from "@/components/charts/colors";
import { SiteHeader } from "@/components/landing/site-header";
import { Logo } from "@/components/shell/logo";
import { Delta } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/auth/context";
import { formatMoney } from "@/lib/format";
import { publicPlans } from "@/lib/queries/public";

export const metadata: Metadata = {
  title: { absolute: "PontoSmart — Controlo de ponto, assiduidade e salários" },
  description: "Marcação por QR Code dinâmico e geofence, justificações, processamento salarial e recibos. Feito para empresas em Moçambique.",
};

// Dados ilustrativos para a pré-visualização do produto.
const trend = [
  { d: "Seg", pontualidade: 88, presenca: 94 },
  { d: "Ter", pontualidade: 91, presenca: 96 },
  { d: "Qua", pontualidade: 86, presenca: 93 },
  { d: "Qui", pontualidade: 93, presenca: 97 },
  { d: "Sex", pontualidade: 89, presenca: 95 },
  { d: "Sáb", pontualidade: 95, presenca: 98 },
  { d: "Seg ", pontualidade: 92, presenca: 96 },
  { d: "Ter ", pontualidade: 94, presenca: 97 },
];
const byDept = [
  { dep: "Operações", pontual: 62, atraso: 8 },
  { dep: "Armazém", pontual: 74, atraso: 14 },
  { dep: "Administrativo", pontual: 48, atraso: 4 },
  { dep: "Segurança", pontual: 30, atraso: 6 },
];

const STEPS = [
  { icon: Building2, title: "A PontoSmart cria a conta da empresa", text: "Peça a conta nesta página. Após validação, a empresa recebe as credenciais do proprietário." },
  { icon: UserPlus, title: "A empresa cria as credenciais da equipa", text: "O proprietário ou o RH regista colaboradores, supervisores e financeiro, com papéis e permissões próprios." },
  { icon: QrCode, title: "Os colaboradores marcam ponto", text: "No telemóvel, lêem o QR dinâmico da estação. O servidor valida o código, o perímetro GPS e a hora." },
  { icon: Wallet, title: "RH e Financeiro fecham o mês", text: "Justificações aprovadas, assiduidade fechada, salários calculados, aprovados por outra pessoa e recibos emitidos." },
];

const FEATURES = [
  { icon: QrCode, title: "QR dinâmico assinado", text: "Muda a cada 30 segundos no ecrã da recepção. Fotografias antigas deixam de funcionar." },
  { icon: LocateFixed, title: "Geofence com precisão", text: "Perímetro por local em PostGIS. GPS impreciso vai para revisão — nunca é tratado como fraude." },
  { icon: CalendarCheck2, title: "Assiduidade automática", text: "Atrasos com tolerância, intervalos, horas extra, feriados e turnos que atravessam a meia-noite." },
  { icon: FileCheck2, title: "Justificações com anexos", text: "Pedido no telemóvel, análise do supervisor e do RH, decisão fundamentada e histórico completo." },
  { icon: ReceiptText, title: "Salários e recibos", text: "Motor determinístico e versionado, aprovação com separação de funções, recibos PDF e Excel." },
  { icon: BarChart3, title: "Relatórios e assistente", text: "Painéis por departamento, exportações e um assistente de IA que consulta dados sem decidir por si." },
];

export default async function Home() {
  const [ctx, plans] = await Promise.all([getContext().catch(() => null), publicPlans()]);
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader loggedIn={!!ctx} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-20">
          <div className="flex flex-col justify-center">
            <p className="text-[13px] font-medium text-primary">Para empresas em Moçambique · MZN · Africa/Maputo</p>
            <h1 className="mt-4 text-[34px] leading-[1.1] font-semibold tracking-tight sm:text-[46px]">
              Controlo de ponto sem relógios de ponto.
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted">
              Os colaboradores marcam entrada e saída no próprio telemóvel, com QR Code dinâmico e localização validada no servidor.
              A assiduidade, as justificações e os salários ficam num só painel.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/registo">Pedir conta para a empresa <ArrowRight /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#funcionamento">Como funciona</a>
              </Button>
            </div>
            <ul className="mt-8 grid gap-2 text-[13px] text-muted sm:grid-cols-2">
              {["Funciona em Android, iPhone e computador", "Sem instalação nem hardware dedicado", "Dados isolados por empresa", "Aprovação humana antes de qualquer recibo"].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check className="size-4 text-success" /> {t}</li>
              ))}
            </ul>
          </div>

          {/* Pré-visualização com os dois tipos de gráfico */}
          <div className="rounded-[22px] border border-border bg-background p-4 shadow-panel sm:p-6" aria-label="Pré-visualização do painel (dados ilustrativos)">
            <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-surface/60 sm:grid-cols-3">
              {[
                ["Presentes hoje", "118", 2.4],
                ["Pontualidade", "94,2%", 1.7],
                ["Pendências", "3", -1.2],
              ].map(([k, v, d], i) => (
                <div key={k as string} className={`px-4 py-3.5 ${i === 2 ? "hidden sm:block" : ""}`}>
                  <p className="text-xs font-medium">{k}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[22px] font-semibold tracking-tight tabular">{v}</span>
                    <Delta value={d as number} invert={i === 2} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold">Pontualidade e presença</p>
                <Legend items={[{ label: "Pontualidade", color: CHART_COLORS.primary }, { label: "Presença", color: CHART_COLORS.indigo }]} />
              </div>
              <SmoothArea data={trend} category="d" percent series={[{ key: "pontualidade", name: "Pontualidade %" }, { key: "presenca", name: "Presença %" }]} />
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold">Por departamento</p>
                <Legend items={[{ label: "Pontual", color: CHART_COLORS.indigo }, { label: "Atraso", color: CHART_COLORS.indigoSoft }]} />
              </div>
              <GroupedBars data={byDept} category="dep" series={[{ key: "pontual", name: "Pontual", tone: "strong" }, { key: "atraso", name: "Atraso", tone: "soft" }]} />
            </div>
            <p className="mt-2 text-right text-[11px] text-subtle">Dados ilustrativos</p>
          </div>
        </div>
      </section>

      {/* Funcionamento */}
      <section id="funcionamento" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-[13px] font-medium text-primary">Funcionamento</p>
          <h2 className="mt-2 max-w-2xl text-[28px] leading-tight font-semibold tracking-tight">Da conta da empresa ao recibo, em quatro passos</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-border bg-background p-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary"><s.icon className="size-5" /></span>
                  <span className="text-[13px] font-semibold text-subtle tabular">0{i + 1}</span>
                </div>
                <p className="mt-4 text-[15px] font-semibold">{s.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 grid gap-4 rounded-2xl bg-surface p-5 sm:p-8 lg:grid-cols-3">
            {[
              { icon: KeyRound, title: "Quem cria as credenciais?", text: "A conta da empresa é criada pela PontoSmart. Depois, a própria empresa cria as contas dos colaboradores e define quem é RH, financeiro ou supervisor." },
              { icon: MonitorSmartphone, title: "O que é preciso no local?", text: "Um tablet, telemóvel ou computador na recepção a mostrar o QR dinâmico. Os colaboradores usam o próprio telemóvel." },
              { icon: ScrollText, title: "E se o GPS falhar?", text: "A marcação fica em revisão e o supervisor ou o RH confirma. Tudo fica registado no trilho de auditoria." },
            ].map((f) => (
              <div key={f.title}>
                <f.icon className="size-5 text-primary" />
                <p className="mt-3 text-[15px] font-semibold">{f.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section id="funcionalidades" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-[13px] font-medium text-primary">Funcionalidades</p>
          <h2 className="mt-2 max-w-2xl text-[28px] leading-tight font-semibold tracking-tight">Tudo o que o RH precisa, sem folhas de cálculo</h2>
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <span className="flex size-10 items-center justify-center rounded-lg border border-border"><f.icon className="size-5 text-foreground" strokeWidth={1.7} /></span>
                <p className="mt-4 text-[15px] font-semibold">{f.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Preços */}
      <section id="precos" className="scroll-mt-20 border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-[13px] font-medium text-primary">Preços</p>
          <h2 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">Planos mensais em meticais</h2>
          <p className="mt-2 max-w-xl text-[14px] text-muted">Período experimental incluído. Os valores não incluem IVA.</p>
          {plans.length ? (
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {plans.map((p, i) => {
                const featured = plans.length === 3 && i === 1;
                return (
                  <div key={p.id} className={`flex flex-col rounded-2xl border bg-background p-6 ${featured ? "border-primary shadow-panel" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[16px] font-semibold">{p.name}</p>
                      {featured ? <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">Mais escolhido</span> : null}
                    </div>
                    <p className="mt-4 text-[32px] font-semibold tracking-tight tabular">
                      {formatMoney(p.priceMonthly, p.currency)}
                      <span className="text-[14px] font-normal text-muted"> /mês</span>
                    </p>
                    <p className="text-[13px] text-muted">Até {p.maxEmployees} colaboradores</p>
                    <ul className="mt-6 space-y-2.5 text-[13px]">
                      {p.modules.map((m) => (
                        <li key={m} className="flex items-center gap-2"><Check className="size-4 text-success" /> {MODULE_LABEL[m] ?? m}</li>
                      ))}
                    </ul>
                    <Button className="mt-8" variant={featured ? "primary" : "outline"} asChild>
                      <Link href={`/registo?plano=${p.code}`}>Escolher {p.name}</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-8 text-[14px] text-muted">Os planos estão a ser actualizados. <Link className="font-medium text-primary" href="/registo">Peça uma proposta.</Link></p>
          )}
        </div>
      </section>

      {/* Segurança */}
      <section id="seguranca" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-[13px] font-medium text-primary">Segurança e conformidade</p>
            <h2 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">Cada empresa vê apenas os seus dados</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">
              Permissões por papel, verificação em dois passos para administradores, documentos privados e um trilho de auditoria que não pode ser apagado.
              Os cálculos salariais seguem regras versionadas que devem ser validadas por um especialista laboral e contabilístico.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              "Isolamento total entre empresas",
              "Verificação em dois passos (MFA)",
              "Hora de marcação definida pelo servidor",
              "Sem rastreio contínuo de localização",
              "Recibos imutáveis após aprovação",
              "Sem multas automáticas por atraso",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border border-border p-4 text-[13px]">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary px-6 py-10 text-white sm:px-10 md:flex-row md:items-center">
            <div>
              <p className="text-[24px] font-semibold tracking-tight">Pronto para deixar o livro de ponto?</p>
              <p className="mt-1 text-[14px] text-white/80">Envie o pedido. Respondemos com as credenciais da conta da empresa.</p>
            </div>
            <Button size="lg" variant="outline" className="border-white/30 bg-white text-primary hover:bg-white/90" asChild>
              <Link href="/registo">Pedir conta</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} PontoSmart · Maputo, Moçambique</p>
          <Link href="/login" className="hover:text-foreground">Entrar</Link>
        </div>
      </footer>
    </div>
  );
}

const MODULE_LABEL: Record<string, string> = {
  ponto: "Marcação por QR e geofence",
  assiduidade: "Assiduidade e correcções",
  justificacoes: "Justificações com anexos",
  salarios: "Processamento salarial e recibos",
  relatorios: "Relatórios e exportação Excel",
  ia: "Assistente de IA",
  multi_filial: "Várias filiais",
};
