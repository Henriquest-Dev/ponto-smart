import Link from "next/link";
import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:p-3">
      <div className="grid min-h-dvh bg-background lg:min-h-[calc(100dvh-24px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden lg:rounded-[22px] lg:shadow-panel">
        <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
          <Link href="/" aria-label="PontoSmart — página inicial" className="w-fit">
            <Logo />
          </Link>
          <div className="flex flex-1 items-center py-10">
            <div className="mx-auto w-full max-w-[380px]">{children}</div>
          </div>
          <p className="text-xs text-subtle">PontoSmart, Maputo, Moçambique</p>
        </div>
        <aside className="relative hidden flex-col justify-center overflow-hidden bg-surface p-14 lg:flex">
          <h2 className="max-w-md text-[28px] leading-[1.2] font-semibold tracking-tight">Cada acesso foi criado por alguém responsável.</h2>
          <ul className="mt-8 max-w-md space-y-5 text-[15px] leading-relaxed text-muted">
            <li>
              <span className="font-medium text-foreground">Colaboradores</span> recebem o utilizador e a palavra-passe dos Recursos Humanos da
              empresa.
            </li>
            <li>
              <span className="font-medium text-foreground">Empresas</span> recebem a conta do responsável quando o pedido é aprovado pela
              PontoSmart.
            </li>
            <li>
              <span className="font-medium text-foreground">Esqueceu a palavra-passe?</span> Peça ao responsável da sua empresa para a redefinir.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
