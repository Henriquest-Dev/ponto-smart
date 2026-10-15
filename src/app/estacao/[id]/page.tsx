import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { attendanceStations, workLocations } from "@/lib/db/schema";
import { StationDisplay } from "./station-display";

export const metadata: Metadata = { title: "Estação de marcação" };

export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany("stations.display", "locations.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await db
    .select({ s: attendanceStations, location: workLocations.name })
    .from(attendanceStations)
    .innerJoin(workLocations, eq(workLocations.id, attendanceStations.locationId))
    .where(and(eq(attendanceStations.id, id), eq(attendanceStations.companyId, ctx.company.id)))
    .limit(1);
  if (!row || row.s.qrMode !== "dynamic") notFound();
  return <StationDisplay stationId={row.s.id} name={row.s.name} location={row.location} company={ctx.company.name} timeZone={ctx.company.timezone} />;
}
