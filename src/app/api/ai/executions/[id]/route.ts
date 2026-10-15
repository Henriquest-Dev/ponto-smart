import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withCompany, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { aiConversations, aiToolExecutions, employees } from "@/lib/db/schema";
import { audit } from "@/lib/domain/audit";
import { notifyUsers } from "@/lib/domain/notifications";
import { teamFilter } from "@/lib/queries/scope";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function load(companyId: string, userId: string, id: string) {
  const [row] = await db
    .select({ e: aiToolExecutions })
    .from(aiToolExecutions)
    .innerJoin(aiConversations, eq(aiConversations.id, aiToolExecutions.conversationId))
    .where(and(eq(aiToolExecutions.id, id), eq(aiToolExecutions.companyId, companyId), eq(aiConversations.userId, userId)))
    .limit(1);
  if (!row) throw new HttpError(404, "Execução não encontrada.");
  return row.e;
}

/** GET — rascunho/documento produzido pelo assistente (documento: ?download=1 devolve .md). */
export const GET = withCompany<{ id: string }>(["ai.use"], async ({ req, ctx, params }) => {
  const e = await load(ctx.company.id, ctx.user.id, params.id);
  const out = (e.output ?? {}) as Record<string, unknown>;
  if (e.tool === "generateDocument" && new URL(req.url).searchParams.get("download")) {
    const title = String(out.title ?? "documento");
    return new Response(String(out.markdown ?? ""), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title.replace(/[^\w\- ]+/g, "").slice(0, 60) || "documento")}.md"`,
      },
    });
  }
  return NextResponse.json({ ok: true, tool: e.tool, approvalStatus: e.approvalStatus, output: e.output });
});

/** POST — confirmação humana de um rascunho de notificação (decision: approve | reject). */
export const POST = withCompany<{ id: string }>(["ai.use"], async ({ req, ctx, params }) => {
  const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await req.json());
  const e = await load(ctx.company.id, ctx.user.id, params.id);
  if (e.tool !== "createNotificationDraft" || e.approvalStatus !== "pending") throw new HttpError(409, "Nada para confirmar.");
  if (decision === "reject") {
    await db.update(aiToolExecutions).set({ approvalStatus: "rejected", approvedBy: ctx.user.id }).where(eq(aiToolExecutions.id, e.id));
    return NextResponse.json({ ok: true, sent: 0 });
  }
  const input = e.input as { title: string; body: string; employeeCodes: string[] };
  const recipients = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.companyId, ctx.company.id), eq(employees.status, "active"), teamFilter(ctx), input.employeeCodes?.length ? inArray(employees.employeeCode, input.employeeCodes) : undefined));
  const ids = recipients.map((r) => r.userId).filter((x): x is string => !!x);
  await notifyUsers(ctx.company.id, ids, { kind: "announcement", title: input.title, body: input.body });
  await db.update(aiToolExecutions).set({ approvalStatus: "approved", approvedBy: ctx.user.id }).where(eq(aiToolExecutions.id, e.id));
  await audit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "ai.notification_sent", entity: "ai_tool_execution", entityId: e.id, after: { recipients: ids.length } });
  return NextResponse.json({ ok: true, sent: ids.length });
});
