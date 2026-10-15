import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { requireContext, homeFor } from "@/lib/auth/context";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="min-h-dvh lg:p-3">
      <div className="min-h-dvh bg-background lg:min-h-[calc(100dvh-24px)] lg:rounded-[22px] lg:shadow-panel">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
          <Logo />
          <Link href={homeFor({ ...ctx, mfaSetupRequired: false })} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
