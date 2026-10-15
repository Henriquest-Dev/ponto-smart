import { count, desc, gte, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { requireContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceEvents, attendanceStations, auditLogs, sessions } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Saúde do serviço" };

export default async function HealthPage() {
  await requireContext("platform.health.view");
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  const latency = Date.now() - t0;
  const since = new Date(Date.now() - 86400_000);
  const [[sessionsActive], [failedLogins], byStatus, [staleStations], recent, [{ size }]] = await Promise.all([
    db.select({ n: count() }).from(sessions).where(gte(sessions.expiresAt, new Date())),
    db.select({ n: count() }).from(auditLogs).where(sql`${auditLogs.action} = 'auth.login_failed' and ${auditLogs.createdAt} >= ${since}`),
    db.select({ status: attendanceEvents.status, n: count() }).from(attendanceEvents).where(gte(attendanceEvents.occurredAt, since)).groupBy(attendanceEvents.status),
    db.select({ n: count() }).from(attendanceStations).where(sql`${attendanceStations.active} and ${attendanceStations.qrMode} = 'dynamic' and (${attendanceStations.lastSeenAt} is null or ${attendanceStations.lastSeenAt} < now() - interval '1 day')`),
    db
      .select({ action: auditLogs.action, createdAt: auditLogs.createdAt, ip: auditLogs.ip })
      .from(auditLogs)
      .where(inArray(auditLogs.action, ["auth.login_failed", "auth.mfa_failed", "attendance.clock_refused", "platform.company_status", "platform.company_created"]))
      .orderBy(desc(auditLogs.createdAt))
      .limit(15),
    db.execute<{ size: string }>(sql`select pg_size_pretty(pg_database_size(current_database())) as size`),
  ]);
  const ev = (s: string) => byStatus.find((b) => b.status === s)?.n ?? 0;
  return (
    <>
      <PageHeader title="Saúde do serviço" description="Indicadores operacionais (últimas 24 h). Objectivo de disponibilidade: 99,5%." />
      <PageBody>
        <StatRow>
          <Stat label="Latência da base de dados" value={`${latency} ms`} hint={latency < 100 ? "Normal" : "Elevada"} />
          <Stat label="Sessões activas" value={sessionsActive.n} />
          <Stat label="Logins falhados" value={failedLogins.n} hint="Rate limiting activo" />
          <Stat label="Tamanho da BD" value={size} />
        </StatRow>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Marcações (24 h)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              {[["Validadas", ev("accepted"), "success"], ["Em revisão", ev("review"), "primary"], ["Rejeitadas", ev("rejected"), "danger"]].map(([l, n, t]) => (
                <div key={l as string} className="rounded-lg bg-surface py-4">
                  <p className="text-[24px] font-semibold tabular">{n as number}</p>
                  <Badge tone={t as "success"}>{l as string}</Badge>
                </div>
              ))}
              <p className="col-span-3 mt-2 text-left text-xs text-muted">{staleStations.n} estações de QR dinâmico sem actividade há mais de 24 h.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Eventos de segurança recentes</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-[13px]">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-mono text-xs">{r.action}</span>
                    <span className="text-xs text-muted">{formatDateTime(r.createdAt)} · {r.ip ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
