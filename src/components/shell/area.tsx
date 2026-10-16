"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem, NavSection } from "@/components/shell/nav-types";
import type { NotificationView } from "@/components/shell/notification-bell";
import type { MenuLink } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { sb } from "@/lib/sb/client";
import { homeFor, useSession, type Me, type Membership } from "@/lib/sb/session";

type Kind = "app" | "empresa" | "admin";

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-center">{children}</div>;
}

export function LoadingScreen() {
  return (
    <FullScreen>
      <span className="spinner text-[28px] text-primary" role="status" aria-label="A carregar" />
    </FullScreen>
  );
}

function allowed(kind: Kind, me: Me, company: Membership | null) {
  if (kind === "admin") return me.isPlatformAdmin;
  if (kind === "app") return !!company?.employeeId;
  return !!company && company.role !== "employee";
}

/** Área protegida: confirma a sessão, o papel e monta a navegação. */
export function Area({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  const { state, me, company, can, setCompany, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (state.status === "anon" || state.status === "mfa") router.replace(`/login/?next=${encodeURIComponent(pathname)}`);
    else if (state.status === "ready" && !allowed(kind, state.me, company)) router.replace(homeFor(state.me, company));
  }, [state, company, kind, router, pathname]);

  const notifications = useNotifications(kind !== "admin" ? company?.companyId ?? null : null, company?.timezone);

  if (state.status === "error") {
    return (
      <FullScreen>
        <div className="max-w-sm space-y-4">
          <p className="text-[15px] font-semibold">Não foi possível abrir a sua conta</p>
          <p className="text-[13px] text-muted">{state.message}</p>
          <Button asChild>
            <Link href="/login/">Voltar ao login</Link>
          </Button>
        </div>
      </FullScreen>
    );
  }
  if (state.status !== "ready" || !me || !allowed(kind, me, company)) return <LoadingScreen />;

  const links: MenuLink[] = [];
  if (kind !== "app" && company?.employeeId) links.push({ href: "/app/", label: "O meu ponto" });
  if (kind !== "empresa" && company && company.role !== "employee") links.push({ href: "/empresa/", label: "Painel da empresa" });
  if (kind !== "admin" && me.isPlatformAdmin) links.push({ href: "/admin/", label: "Plataforma" });
  if (kind === "app") links.push({ href: "/app/perfil/", label: "Perfil e dispositivos" });
  links.push({ href: "/conta/", label: "Segurança da conta" });

  const user = {
    name: me.name,
    email: me.login,
    links,
    companies: kind === "admin" ? [] : me.memberships.map((m) => ({ id: m.companyId, name: m.companyName, active: m.companyId === company?.companyId })),
    onSwitchCompany: (id: string) => {
      setCompany(id);
      const next = me.memberships.find((m) => m.companyId === id) ?? null;
      router.push(homeFor(me, next));
    },
    onLogout: async () => {
      await signOut();
      router.replace("/login/");
    },
  };

  const nav = kind === "admin" ? adminNav() : kind === "app" ? appNav() : companyNav(can);

  return (
    <AppShell
      sections={nav.sections}
      root={nav.root}
      subtitle={kind === "admin" ? "Administração da plataforma" : company?.companyName}
      user={user}
      notifications={notifications}
      mobileTabs={nav.tabs}
      centerAction={kind === "app" ? { href: "/app/marcar/", label: "Marcar ponto" } : undefined}
      searchHref={kind === "empresa" && can("employees.view") ? "/empresa/colaboradores/" : undefined}
    >
      <React.Suspense fallback={null}>{children}</React.Suspense>
    </AppShell>
  );
}

function appNav() {
  const sections: NavSection[] = [
    {
      items: [
        { href: "/app/", label: "Início" },
        { href: "/app/marcar/", label: "Marcar ponto" },
        { href: "/app/historico/", label: "Histórico" },
        { href: "/app/justificacoes/", label: "Justificações" },
        { href: "/app/recibos/", label: "Recibos" },
        { href: "/app/perfil/", label: "Perfil" },
      ],
    },
  ];
  const tabs: NavItem[] = [
    { href: "/app/", label: "Início" },
    { href: "/app/historico/", label: "Histórico" },
    { href: "/app/justificacoes/", label: "Faltas" },
    { href: "/app/recibos/", label: "Recibos" },
  ];
  return { root: "/app/", sections, tabs };
}

function adminNav() {
  const items: NavItem[] = [
    { href: "/admin/", label: "Visão geral" },
    { href: "/admin/empresas/", label: "Empresas" },
    { href: "/admin/pedidos/", label: "Pedidos de acesso" },
    { href: "/admin/assistente/", label: "Assistente" },
    { href: "/admin/auditoria/", label: "Auditoria" },
  ];
  const short: Record<string, string> = { "/admin/": "Início", "/admin/pedidos/": "Pedidos" };
  return { root: "/admin/", sections: [{ items }], tabs: items.slice(0, 3).map((i) => ({ ...i, label: short[i.href] ?? i.label })) };
}

function companyNav(can: (...p: string[]) => boolean) {
  const operations: NavItem[] = [{ href: "/empresa/", label: "Painel" }];
  if (can("employees.view")) operations.push({ href: "/empresa/colaboradores/", label: "Colaboradores" });
  if (can("attendance.view")) operations.push({ href: "/empresa/assiduidade/", label: "Assiduidade" });
  if (can("absence.decide", "absence.decide.team")) operations.push({ href: "/empresa/justificacoes/", label: "Justificações" });
  if (can("locations.manage")) operations.push({ href: "/empresa/qr/", label: "QR Code" });

  const finance: NavItem[] = [];
  if (can("payroll.view"))
    finance.push({
      href: "/empresa/salarios/",
      label: "Salários",
      children: [
        { href: "/empresa/salarios/", label: "Processamento" },
        { href: "/empresa/salarios/rubricas/", label: "Rubricas e regras" },
      ],
    });
  if (can("reports.view")) finance.push({ href: "/empresa/relatorios/", label: "Relatórios" });

  const setup: NavItem[] = [];
  if (can("schedules.manage")) setup.push({ href: "/empresa/horarios/", label: "Horários e feriados" });
  if (can("locations.manage", "stations.display")) setup.push({ href: "/empresa/locais/", label: "Locais e estações" });
  if (can("ai.use")) setup.push({ href: "/empresa/assistente/", label: "Assistente" });
  if (can("audit.view")) setup.push({ href: "/empresa/auditoria/", label: "Auditoria" });
  if (can("company.settings.manage", "users.manage", "org.manage")) setup.push({ href: "/empresa/definicoes/", label: "Definições" });

  const sections: NavSection[] = [{ items: operations }];
  if (finance.length) sections.push({ title: "Gestão", items: finance });
  if (setup.length) sections.push({ title: "Configuração", items: setup });

  const tabs: NavItem[] = [operations[0]];
  for (const href of ["/empresa/assiduidade/", "/empresa/justificacoes/", "/empresa/salarios/", "/empresa/colaboradores/"]) {
    const item = [...operations, ...finance].find((i) => i.href === href);
    if (item && tabs.length < 4) tabs.push({ ...item, children: undefined, label: item.label === "Justificações" ? "Faltas" : item.label === "Colaboradores" ? "Equipa" : item.label });
  }
  return { root: "/empresa/", sections, tabs };
}

function useNotifications(companyId: string | null, tz = "Africa/Maputo") {
  const [items, setItems] = React.useState<NotificationView[]>([]);
  const [unread, setUnread] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!companyId) return;
    const { data } = await sb()
      .from("notifications")
      .select("id,title,body,link,read_at,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(12);
    const { count } = await sb()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("read_at", null);
    setItems(
      (data ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        when: formatDateTime(n.created_at, tz),
        unread: !n.read_at,
      })),
    );
    setUnread(count ?? 0);
  }, [companyId, tz]);

  React.useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const onMarkRead = React.useCallback(async () => {
    if (!companyId) return;
    await sb().from("notifications").update({ read_at: new Date().toISOString() }).eq("company_id", companyId).is("read_at", null);
    await load();
  }, [companyId, load]);

  return { items, unread, onMarkRead };
}
