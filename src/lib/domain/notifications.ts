import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberships, notifications, roles } from "@/lib/db/schema";
import type { RoleCode } from "@/lib/auth/rbac";

type NotificationInput = { kind: string; title: string; body?: string; link?: string };

export async function notifyUsers(companyId: string, userIds: string[], n: NotificationInput) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  await db.insert(notifications).values(unique.map((userId) => ({ companyId, userId, ...n })));
}

export async function notifyRoles(companyId: string, roleCodes: RoleCode[], n: NotificationInput) {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.companyId, companyId), eq(memberships.active, true), inArray(roles.code, roleCodes)));
  await notifyUsers(companyId, rows.map((r) => r.userId), n);
}
