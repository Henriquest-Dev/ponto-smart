import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import type { AppContext } from "@/lib/auth/context";
import type { MenuLink } from "@/components/shell/user-menu";
import type { NotificationView } from "@/components/shell/notification-bell";
import { formatDateTime } from "@/lib/format";

export async function shellData(ctx: AppContext, area: "app" | "empresa" | "admin") {
  let items: NotificationView[] = [];
  let unread = 0;
  if (ctx.company) {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.companyId, ctx.company.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(12);
    const [{ n }] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.companyId, ctx.company.id), isNull(notifications.readAt)));
    unread = n;
    items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      link: r.link,
      when: formatDateTime(r.createdAt, ctx.company!.timezone),
      unread: !r.readAt,
    }));
  }

  const links: MenuLink[] = [];
  if (area !== "app" && ctx.employee) links.push({ href: "/app", label: "O meu ponto", icon: "app" });
  if (area !== "empresa" && ctx.role && ctx.role !== "employee") links.push({ href: "/empresa", label: "Painel da empresa", icon: "company" });
  if (area !== "admin" && ctx.user.isPlatformAdmin) links.push({ href: "/admin", label: "Plataforma", icon: "platform" });
  if (area === "app") links.push({ href: "/app/perfil", label: "Perfil e dispositivos", icon: "profile" });
  links.push({ href: "/conta/seguranca", label: "Segurança da conta", icon: "security" });

  return {
    user: {
      name: ctx.user.name,
      email: ctx.user.email,
      links,
      companies: ctx.memberships.map((m) => ({ id: m.companyId, name: m.companyName, active: m.companyId === ctx.company?.id })),
    },
    notifications: { items, unread },
  };
}
