"use client";

import Link from "next/link";
import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/sb/session";

export function SiteHeader() {
  const { state } = useSession();
  const loggedIn = state.status === "ready";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" aria-label="Horbit, página inicial">
          <Wordmark className="h-7" />
        </Link>
        <nav className="hidden items-center gap-7 text-[14.5px] font-bold text-muted md:flex" aria-label="Navegação">
          <a href="#pedir-conta" className="hover:text-foreground">Guia</a>
          <Link href="/comecar/" className="hover:text-foreground">Apresentação</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {loggedIn ? (
            <Button asChild>
              <Link href="/inicio/">Abrir o meu painel</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login/">Entrar</Link>
              </Button>
              <Button asChild className="hidden sm:inline-flex">
                <Link href="/registo/">Pedir conta</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
