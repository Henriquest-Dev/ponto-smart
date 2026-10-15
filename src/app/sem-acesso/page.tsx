import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getContext } from "@/lib/auth/context";
import { logoutAction } from "../(auth)/actions";

export const metadata = { title: "Sem acesso" };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const ctx = await getContext();
  const message =
    motivo === "sem-ficha"
      ? "A sua conta não está associada a uma ficha de colaborador activa nesta empresa."
      : ctx && !ctx.company && ctx.memberships.length
        ? "A empresa associada à sua conta está suspensa. Contacte o administrador."
        : "Não tem permissão para aceder a esta área.";
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 text-center shadow-panel">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Acesso indisponível</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">Voltar ao início</Link>
          </Button>
          {ctx ? (
            <form action={logoutAction}>
              <Button variant="ghost" type="submit">Terminar sessão</Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
