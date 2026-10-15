import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, DescriptionList, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { requireEmployee } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { departments, employees, trustedDevices } from "@/lib/db/schema";
import { formatDate, formatDateTime } from "@/lib/format";
import { logoutAction } from "@/app/(auth)/actions";
import { DeviceControls, RevokeDevice } from "./devices";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const ctx = await requireEmployee();
  const tz = ctx.company.timezone;
  const [emp] = await db
    .select({ e: employees, dept: departments.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, ctx.employee.id))
    .limit(1);
  const devices = await db
    .select()
    .from(trustedDevices)
    .where(and(eq(trustedDevices.employeeId, ctx.employee.id), isNull(trustedDevices.revokedAt)));
  const policy = ctx.company.settings.devicePolicy;

  return (
    <>
      <PageHeader title="Perfil" />
      <PageBody className="mx-auto max-w-3xl">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar name={emp.e.fullName} size={52} />
            <div className="min-w-0">
              <p className="text-[17px] font-semibold">{emp.e.fullName}</p>
              <p className="text-[13px] text-muted">{emp.e.jobTitle ?? "—"} · {ctx.company.name}</p>
            </div>
          </div>
          <DescriptionList
            className="mt-5 border-t border-border pt-5"
            items={[
              ["Nº mecanográfico", emp.e.employeeCode],
              ["Departamento", emp.dept ?? "—"],
              ["Email", emp.e.email ?? ctx.user.email],
              ["Telefone", emp.e.phone ?? "—"],
              ["Data de admissão", formatDate(emp.e.hireDate, tz)],
              ["NUIT", emp.e.nuit ?? "—"],
            ]}
          />
          <p className="mt-4 text-xs text-muted">Para corrigir dados pessoais, contacte os Recursos Humanos.</p>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Dispositivos de confiança</CardTitle>
              <CardDescription>
                {policy === "require"
                  ? "A empresa exige marcação a partir de um dispositivo registado."
                  : policy === "warn"
                    ? "Marcações de dispositivos não registados ficam assinaladas."
                    : "A empresa não exige dispositivos registados."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <DeviceControls />
            {devices.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{d.label}</p>
                      <p className="text-xs text-muted">Registado {formatDate(d.createdAt, tz)}{d.lastUsedAt ? ` · última marcação ${formatDateTime(d.lastUsedAt, tz)}` : ""}</p>
                    </div>
                    <RevokeDevice id={d.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nenhum dispositivo registado.</p>
            )}
            <Notice tone="info">
              Numa aplicação web não é possível identificar o hardware de forma infalível. O registo é um factor adicional de confiança, não uma prova.
            </Notice>
          </CardContent>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-[15px] font-semibold">Segurança da conta</p>
            <p className="text-[13px] text-muted">Palavra-passe e verificação em dois passos.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/conta/seguranca">Gerir</Link>
            </Button>
            <form action={logoutAction}>
              <Button variant="danger-outline" type="submit">Terminar sessão</Button>
            </form>
          </div>
        </Card>
        {ctx.user.mfaEnabled ? <Badge tone="success">Verificação em dois passos activa</Badge> : null}
      </PageBody>
    </>
  );
}
