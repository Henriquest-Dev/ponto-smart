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
      <div className="max-w-sm space-y-4">
        <span className="flex items-end gap-[6px] text-primary" aria-hidden>
          <span className="block h-5 w-[7px] rounded-full bg-current opacity-30" />
          <span className="block h-9 w-[7px] rounded-full bg-current" />
          <span className="block h-5 w-[7px] rounded-full bg-current opacity-30" />
        </span>
        <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em]">Conta sem empresa activa</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          A sua conta existe, mas não está ligada a nenhuma empresa activa. Fale com o responsável da sua empresa ou com o suporte Horbit.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
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
