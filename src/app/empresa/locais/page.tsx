import { asc, eq } from "drizzle-orm";
import { MapPin, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { can, requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceStations, branches, workLocations } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { toggleStationAction } from "./actions";
import { LocationEditor, LocationPreview, NewStation, StaticQr } from "./forms";

export const metadata: Metadata = { title: "Locais e estações" };

export default async function LocationsPage() {
  const ctx = await requireCompany("locations.manage", "stations.display");
  const tz = ctx.company.timezone;
  const manage = can(ctx, "locations.manage");
  const [locations, stations, branchList] = await Promise.all([
    db.select({ l: workLocations, branch: branches.name }).from(workLocations).leftJoin(branches, eq(branches.id, workLocations.branchId)).where(eq(workLocations.companyId, ctx.company.id)).orderBy(asc(workLocations.name)),
    db.select().from(attendanceStations).where(eq(attendanceStations.companyId, ctx.company.id)).orderBy(asc(attendanceStations.name)),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.companyId, ctx.company.id)),
  ]);

  return (
    <>
      <PageHeader title="Locais e estações" description="Perímetros de marcação (geofence) e ecrãs de QR Code." actions={manage ? <LocationEditor branches={branchList} /> : null} />
      <PageBody>
        <Notice tone="info">
          Recomenda-se QR dinâmico num ecrã (tablet ou computador) na recepção: muda a cada poucos segundos e não pode ser fotografado para uso posterior. O QR fixo impresso é copiável e oferece menor garantia.
        </Notice>
        {locations.length === 0 ? (
          <EmptyState icon={<MapPin />} title="Sem locais configurados" description="Crie um local com o perímetro onde os colaboradores podem marcar ponto." />
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {locations.map(({ l, branch }) => {
              const st = stations.filter((s) => s.locationId === l.id);
              return (
                <Card key={l.id} className="overflow-hidden">
                  <LocationPreview lat={l.centerLat} lng={l.centerLng} radius={l.radiusM} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[15px] font-semibold">{l.name}</p>
                        <p className="text-xs text-muted">
                          {branch ?? "Sem filial"} · raio {l.radiusM} m · precisão GPS aceite até ±{l.maxAccuracyM} m
                        </p>
                      </div>
                      {manage ? (
                        <LocationEditor
                          branches={branchList}
                          location={{ id: l.id, name: l.name, branchId: l.branchId, centerLat: l.centerLat, centerLng: l.centerLng, radiusM: l.radiusM, maxAccuracyM: l.maxAccuracyM }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-4 space-y-2">
                      {st.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                          <MonitorSmartphone className="size-4 text-muted" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{s.name}</p>
                            <p className="text-xs text-muted">
                              {s.qrMode === "dynamic" ? `QR dinâmico · roda a cada ${s.rotationSeconds}s` : "QR fixo (menor garantia)"}
                              {s.lastSeenAt ? ` · activo ${formatDateTime(s.lastSeenAt, tz)}` : ""}
                            </p>
                          </div>
                          {!s.active ? <Badge tone="neutral">Inactiva</Badge> : null}
                          {s.active && s.qrMode === "dynamic" ? (
                            <Button size="sm" variant="soft" asChild>
                              <Link href={`/estacao/${s.id}`} target="_blank">Abrir ecrã</Link>
                            </Button>
                          ) : null}
                          {s.active && s.qrMode === "static" && manage ? <StaticQr stationId={s.id} /> : null}
                          {manage ? (
                            <ActionButton size="sm" variant="ghost" action={toggleStationAction.bind(null, s.id, !s.active)}>
                              {s.active ? "Desactivar" : "Activar"}
                            </ActionButton>
                          ) : null}
                        </div>
                      ))}
                      {manage ? <NewStation locationId={l.id} /> : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
