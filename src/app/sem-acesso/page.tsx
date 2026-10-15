"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/sb/session";

export default function SemAcesso() {
  const { signOut } = useSession();
  const router = useRouter();
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-[20px] font-semibold">Conta sem empresa activa</h1>
        <p className="text-[14px] text-muted">
          A sua conta existe, mas não está ligada a nenhuma empresa activa. Fale com o responsável da sua empresa ou com o suporte PontoSmart.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">Página inicial</Link>
          </Button>
          <Button
            onClick={async () => {
              await signOut();
              router.replace("/login/");
            }}
          >
            Terminar sessão
          </Button>
        </div>
      </div>
    </div>
  );
}
