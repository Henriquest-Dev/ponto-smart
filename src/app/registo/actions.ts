"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { companyRequests } from "@/lib/db/schema";
import { requestMeta } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/domain/audit";
import { formObject, runAction, type ActionResult } from "@/lib/action";

const schema = z.object({
  companyName: z.string().trim().min(2, "Indique o nome da empresa.").max(120),
  nuit: z.string().trim().max(20).optional(),
  contactName: z.string().trim().min(3, "Indique o nome do responsável.").max(120),
  email: z.string().trim().toLowerCase().email("Email inválido."),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(60).optional(),
  employeesEstimate: z.coerce.number().int().min(1).max(100000).optional(),
  planId: z.string().uuid().optional(),
  message: z.string().trim().max(1000).optional(),
  website: z.string().optional(), // armadilha anti-spam (campo invisível)
});

/** Pedido público de conta. A conta só é criada quando o Super Admin aprova. */
export async function requestAccountAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const o = schema.parse(formObject(fd));
    if (o.website) return { ok: true, message: "Pedido recebido." };
    const { ip } = await requestMeta();
    await rateLimit(`signup:${ip ?? "unknown"}`, 5, 3600);
    const [row] = await db
      .insert(companyRequests)
      .values({
        companyName: o.companyName, nuit: o.nuit ?? null, contactName: o.contactName, email: o.email, phone: o.phone ?? null,
        city: o.city ?? null, employeesEstimate: o.employeesEstimate ?? null, planId: o.planId ?? null, message: o.message ?? null, ip,
      })
      .returning({ id: companyRequests.id });
    await audit({ companyId: null, actorId: null, action: "platform.request_received", entity: "company_request", entityId: row.id, after: { company: o.companyName } });
    return { ok: true, message: "Pedido recebido." };
  });
}
