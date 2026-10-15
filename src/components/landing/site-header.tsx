import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shell/logo";

export function SiteHeader({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="PontoSmart — início"><Logo /></Link>
        <nav className="hidden items-center gap-6 text-[14px] text-muted md:flex" aria-label="Secções">
          <Link href="/#funcionamento" className="hover:text-foreground">Funcionamento</Link>
          <Link href="/#funcionalidades" className="hover:text-foreground">Funcionalidades</Link>
          <Link href="/#precos" className="hover:text-foreground">Preços</Link>
          <Link href="/#seguranca" className="hover:text-foreground">Segurança</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {loggedIn ? (
            <Button asChild><Link href="/inicio">Abrir painel</Link></Button>
          ) : (
            <>
              <Button variant="ghost" asChild><Link href="/login">Entrar</Link></Button>
              <Button asChild className="hidden sm:inline-flex"><Link href="/registo">Pedir conta</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
