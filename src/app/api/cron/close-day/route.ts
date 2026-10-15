import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { safeEqual } from "@/lib/crypto";
import { closeDay } from "@/lib/domain/attendance";
import { addDays, localDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/close-day — consolida o dia anterior de todas as empresas activas.
 * Chamado pela função agendada da Netlify (netlify/functions/close-day.mts) com CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(given, secret)) {
    return NextResponse.json({ ok: false, error: { message: "Não autorizado." } }, { status: 401 });
  }
  const list = await db.select().from(companies).where(inArray(companies.status, ["active", "trial"]));
  const results = [];
  for (const c of list) {
    const yesterday = addDays(localDate(new Date(), c.timezone), -1);
    const processed = await closeDay(c.id, yesterday, c.timezone);
    results.push({ company: c.id, date: yesterday, processed });
  }
  return NextResponse.json({ ok: true, results });
}
