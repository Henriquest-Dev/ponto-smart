import "server-only";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { requestMeta } from "@/lib/request";

type Json = Record<string, unknown> | null | undefined;

/** Regista uma acção no trilho de auditoria (apenas acréscimo). */
export async function audit(input: {
  companyId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Json;
  after?: Json;
}) {
  let ip: string | null = null;
  try {
    ip = (await requestMeta()).ip;
  } catch {
    // fora de um pedido HTTP (scripts, cron)
  }
  await db.insert(auditLogs).values({
    companyId: input.companyId,
    actorId: input.actorId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ip,
  });
}
