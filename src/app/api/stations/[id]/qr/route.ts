import { and, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { attendanceStations, qrChallenges } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { signQrToken } from "@/lib/domain/qr";

export const dynamic = "force-dynamic";

/** GET /api/stations/:id/qr — emite um novo QR dinâmico assinado para o ecrã da estação. */
export const GET = withCompany<{ id: string }>(["stations.display", "locations.manage"], async ({ req, ctx, params }) => {
  const [station] = await db
    .select()
    .from(attendanceStations)
    .where(and(eq(attendanceStations.id, params.id), eq(attendanceStations.companyId, ctx.company.id)))
    .limit(1);
  if (!station || !station.active) throw new HttpError(404, "Estação não encontrada ou inactiva.");
  if (station.qrMode !== "dynamic") throw new HttpError(409, "Esta estação usa QR fixo.");

  const ttl = station.rotationSeconds;
  const token = await signQrToken({ sid: station.id, cid: ctx.company.id, mode: "dynamic" }, ttl + 15);
  const now = new Date();
  await db.insert(qrChallenges).values({
    companyId: ctx.company.id,
    stationId: station.id,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + (ttl + 15) * 1000),
  });
  await db.update(attendanceStations).set({ lastSeenAt: now }).where(eq(attendanceStations.id, station.id));
  // Limpeza oportunista de desafios expirados há mais de 1 dia.
  await db.delete(qrChallenges).where(and(eq(qrChallenges.stationId, station.id), lt(qrChallenges.expiresAt, new Date(now.getTime() - 86400_000))));

  const origin = new URL(req.url).origin;
  const url = `${origin}/app/marcar?t=${encodeURIComponent(token)}`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "L", margin: 1, color: { dark: "#11131f", light: "#ffffff" } });
  return NextResponse.json(
    { ok: true, svg, rotateInSeconds: ttl, issuedAt: now.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
