"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { one, useTitle, type One } from "@/components/collab/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, DescriptionList, Notice, Skeleton } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { getDeviceKey } from "@/lib/client/device";
import { formatDate, formatDateTime } from "@/lib/format";
import { must, sb } from "@/lib/sb/client";
import { useCompany, useSession } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { sha256Hex } from "@/lib/sha256";
import { DeviceControls, RevokeDevice } from "./devices";

const CONTRACT_LABEL: Record<string, string> = {
  indeterminado: "Sem termo",
  determinado: "A termo certo",
  estagio: "Estágio",
  prestacao_servicos: "Prestação de serviços",
};

type Employee = {
  full_name: string;
  employee_code: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  hire_date: string | null;
  nuit: string | null;
  departments: One<{ name: string }>;
};
type Contract = { type: string; start_date: string; end_date: string | null; weekly_hours: number };
type Device = { id: string; label: string; credential_id: string; created_at: string; last_used_at: string | null };

export default function ProfilePage() {
  useTitle("Perfil");
  const { company, companyId, me, tz } = useCompany();
  const { signOut } = useSession();
  const router = useRouter();
  const employeeId = company.employeeId!;
  const policy = company.settings.devicePolicy ?? "warn";

  const profile = useData(async () => {
    const [emp, contracts, mfa] = await Promise.all([
      sb()
        .from("employees")
        .select("full_name,employee_code,email,phone,job_title,hire_date,nuit,departments(name)")
        .eq("id", employeeId)
        .single()
        .then(must),
      sb()
        .from("employment_contracts")
        .select("type,start_date,end_date,weekly_hours")
        .eq("employee_id", employeeId)
        .order("start_date", { ascending: false })
        .limit(1)
        .then(must),
      sb()
        .auth.mfa.listFactors()
        .then((r) => !!r.data?.totp?.some((f) => f.status === "verified"))
        .catch(() => false),
    ]);
    return { emp: emp as unknown as Employee, contract: ((contracts ?? []) as Contract[])[0] ?? null, mfa };
  }, [employeeId]);

  const devices = useData(async () => {
    const rows = must(
      await sb()
        .from("trusted_devices")
        .select("id,label,credential_id,created_at,last_used_at")
        .eq("employee_id", employeeId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
    ) as Device[];
    const key = getDeviceKey();
    const mine = key ? sha256Hex(key) : null;
    return rows.map((d) => ({ ...d, current: d.credential_id === mine }));
  }, [employeeId]);

  const p = profile.data;

  return (
    <>
      <PageHeader title="Perfil" />
      <PageBody className="mx-auto max-w-3xl">
        {profile.error ? <Notice tone="danger">{profile.error}</Notice> : null}
        {p ? (
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Avatar name={p.emp.full_name} size={64} className="bg-primary text-white" />
              <div className="min-w-0">
                <p className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{p.emp.full_name}</p>
                <p className="mt-0.5 text-[14px] font-bold text-muted">{p.emp.job_title ?? "—"}</p>
                <p className="text-[13px] text-muted">{company.companyName}</p>
              </div>
            </div>
            <DescriptionList
              className="mt-5 border-t border-border pt-5"
              items={[
                ["Nº mecanográfico", p.emp.employee_code],
                ["Departamento", one(p.emp.departments)?.name ?? "—"],
                ["Email", p.emp.email ?? me.login],
                ["Telefone", p.emp.phone ?? "—"],
                ["Data de admissão", formatDate(p.emp.hire_date, tz)],
                ["NUIT", p.emp.nuit ?? "—"],
                [
                  "Contrato",
                  p.contract
                    ? `${CONTRACT_LABEL[p.contract.type] ?? p.contract.type}${p.contract.end_date ? ` até ${formatDate(p.contract.end_date, tz)}` : ""}`
                    : "—",
                ],
                ["Horário semanal", p.contract ? `${p.contract.weekly_hours} horas` : "—"],
              ]}
            />
            <p className="mt-5 text-[12.5px] text-muted">Para corrigir dados pessoais, contacte os Recursos Humanos.</p>
          </Card>
        ) : profile.loading ? (
          <Skeleton className="h-64 rounded-[22px]" />
        ) : null}

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
            <DeviceControls companyId={companyId} onDone={devices.reload} />
            {devices.error ? <Notice tone="danger">{devices.error}</Notice> : null}
            {devices.data ? (
              devices.data.length ? (
                <ul className="divide-y divide-border overflow-hidden rounded-[18px] bg-surface">
                  {devices.data.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={d.current ? "stem mt-1 text-primary" : "stem mt-1 text-border-strong"} aria-hidden />
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-bold">
                            <span className="truncate">{d.label}</span>
                            {d.current ? <span className="text-[12.5px] text-primary">Este dispositivo</span> : null}
                          </p>
                          <p className="text-[12.5px] text-muted">Registado {formatDate(d.created_at, tz)}</p>
                          {d.last_used_at ? <p className="text-[12.5px] text-muted">Última marcação {formatDateTime(d.last_used_at, tz)}</p> : null}
                        </div>
                      </div>
                      <RevokeDevice id={d.id} onDone={devices.reload} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted">Nenhum dispositivo registado.</p>
              )
            ) : devices.loading ? (
              <Skeleton className="h-14 rounded-[18px]" />
            ) : null}
            <Notice tone="info">
              Numa aplicação web não é possível identificar o hardware de forma infalível. O registo é um factor adicional de confiança, não uma prova.
            </Notice>
          </CardContent>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[16px] font-extrabold tracking-[-0.01em]">
              Segurança da conta
              {p?.mfa ? <Badge tone="success">Dois passos activo</Badge> : null}
            </p>
            <p className="text-[13px] text-muted">Palavra-passe e verificação em dois passos.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/conta/">Gerir</Link>
            </Button>
            <Button
              variant="danger-outline"
              onClick={async () => {
                await signOut();
                router.replace("/login/");
              }}
            >
              Terminar sessão
            </Button>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
