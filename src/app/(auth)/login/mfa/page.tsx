import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSessionRow } from "@/lib/auth/session";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verificação em dois passos" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await readSessionRow();
  if (!session) redirect("/login");
  if (!session.mfaPending) redirect("/");
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">Verificação em dois passos</h1>
      <p className="mt-1.5 text-sm text-muted">Introduza o código de 6 dígitos da sua aplicação de autenticação.</p>
      <MfaForm next={next} />
    </div>
  );
}
