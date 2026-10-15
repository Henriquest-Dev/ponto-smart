import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { requireContext } from "@/lib/auth/context";
import { MfaSetup, PasswordForm, DisableMfa } from "./forms";

export const metadata: Metadata = { title: "Segurança da conta" };

export default async function SecurityPage() {
  const ctx = await requireContext();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Segurança da conta</h1>
        <p className="mt-1 text-[13px] text-muted">{ctx.user.email}</p>
      </div>
      {ctx.mfaSetupRequired ? (
        <Notice tone="warning" title="Acção necessária">
          A política da empresa exige verificação em dois passos para o seu perfil. Configure-a para continuar.
        </Notice>
      ) : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Verificação em dois passos</CardTitle>
            <CardDescription>Código temporário de uma aplicação de autenticação (Google Authenticator, Microsoft Authenticator, 1Password…).</CardDescription>
          </div>
          {ctx.user.mfaEnabled ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}
        </CardHeader>
        <CardContent>{ctx.user.mfaEnabled ? <DisableMfa /> : <MfaSetup />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Palavra-passe</CardTitle>
            <CardDescription>Mínimo de 10 caracteres com letras e números.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
