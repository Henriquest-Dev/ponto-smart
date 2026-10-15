import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:p-3">
      <div className="grid min-h-dvh bg-background lg:min-h-[calc(100dvh-24px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden lg:rounded-[22px] lg:shadow-panel">
        <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
          <Logo />
          <div className="flex flex-1 items-center py-10">
            <div className="mx-auto w-full max-w-[380px]">{children}</div>
          </div>
          <p className="text-xs text-subtle">© {new Date().getFullYear()} PontoSmart · Maputo, Moçambique</p>
        </div>
        <AuthAside />
      </div>
    </div>
  );
}

function AuthAside() {
  const bars = [38, 62, 45, 80, 56, 70, 92, 48, 66, 74, 58, 84];
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-surface p-12 lg:flex">
      <div className="max-w-md">
        <p className="text-[13px] font-medium text-primary">Assiduidade com rigor, sem relógios de ponto</p>
        <h2 className="mt-3 text-[30px] leading-[1.15] font-semibold tracking-tight">
          QR dinâmico, geofence e salários num só painel.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Marcação validada no servidor, justificações com aprovação e processamento salarial com revisão humana.
        </p>
      </div>

      <div className="relative mt-10 rounded-2xl border border-border bg-background p-6 shadow-panel">
        <div className="grid grid-cols-3 divide-x divide-border">
          {[
            ["Presentes hoje", "118", "de 126"],
            ["Pontualidade", "94,2%", "últimos 30 dias"],
            ["Pendências", "3", "por rever"],
          ].map(([k, v, h]) => (
            <div key={k} className="px-4 first:pl-0">
              <p className="text-xs font-medium">{k}</p>
              <p className="mt-1.5 text-[24px] font-semibold tracking-tight tabular">{v}</p>
              <p className="text-[11px] text-muted">{h}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex h-28 items-end gap-2">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t-[4px] bg-primary" style={{ height: `${h}%`, opacity: i === 6 ? 1 : 0.85 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
