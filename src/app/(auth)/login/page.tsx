import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">Entrar no PontoSmart</h1>
      <p className="mt-1.5 text-sm text-muted">Use o utilizador e a palavra-passe que recebeu.</p>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
