import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem, NavSection } from "@/components/shell/nav-types";
import { can, requireCompany } from "@/lib/auth/context";
import { pendingCounts } from "@/lib/queries/company";
import { shellData } from "@/lib/shell";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompany();
  if (!ctx.role || ctx.role === "employee") redirect(ctx.employee ? "/app" : "/sem-acesso");
  if (ctx.mfaSetupRequired) redirect("/conta/seguranca");
  const [shell, pending] = await Promise.all([shellData(ctx, "empresa"), pendingCounts(ctx)]);

  const operations: NavItem[] = [{ href: "/empresa", label: "Painel", icon: "dashboard" }];
  if (can(ctx, "employees.view")) operations.push({ href: "/empresa/colaboradores", label: "Colaboradores", icon: "users" });
  if (can(ctx, "attendance.view"))
    operations.push({
      href: "/empresa/assiduidade",
      label: "Assiduidade",
      icon: "calendar",
      badge: pending.reviews + pending.days || undefined,
      children: [
        { href: "/empresa/assiduidade", label: "Registos diários" },
        { href: "/empresa/assiduidade/revisao", label: "Em revisão" },
        { href: "/empresa/assiduidade/correccoes", label: "Correcções" },
      ],
    });
  if (can(ctx, "absence.decide", "absence.decide.team"))
    operations.push({ href: "/empresa/justificacoes", label: "Justificações", icon: "file", badge: pending.absences || undefined });

  const finance: NavItem[] = [];
  if (can(ctx, "payroll.view"))
    finance.push({
      href: "/empresa/salarios",
      label: "Salários",
      icon: "wallet",
      children: [
        { href: "/empresa/salarios", label: "Processamento" },
        { href: "/empresa/salarios/rubricas", label: "Rubricas e regras" },
      ],
    });
  if (can(ctx, "reports.view")) finance.push({ href: "/empresa/relatorios", label: "Relatórios", icon: "chart" });

  const setup: NavItem[] = [];
  if (can(ctx, "schedules.manage")) setup.push({ href: "/empresa/horarios", label: "Horários e feriados", icon: "clock" });
  if (can(ctx, "locations.manage", "stations.display")) setup.push({ href: "/empresa/locais", label: "Locais e estações", icon: "map" });
  if (can(ctx, "ai.use")) setup.push({ href: "/empresa/assistente", label: "Assistente", icon: "messages" });
  if (can(ctx, "audit.view")) setup.push({ href: "/empresa/auditoria", label: "Auditoria", icon: "scroll" });
  if (can(ctx, "company.settings.manage", "users.manage", "org.manage")) setup.push({ href: "/empresa/definicoes", label: "Definições", icon: "settings" });

  const sections: NavSection[] = [{ items: operations }];
  if (finance.length) sections.push({ title: "Gestão", items: finance });
  if (setup.length) sections.push({ title: "Configuração", items: setup });

  const tabs: NavItem[] = [operations[0]];
  for (const href of ["/empresa/assiduidade", "/empresa/justificacoes", "/empresa/salarios", "/empresa/colaboradores"]) {
    const item = [...operations, ...finance].find((i) => i.href === href);
    if (item && tabs.length < 4) tabs.push({ ...item, label: item.label === "Justificações" ? "Faltas" : item.label });
  }

  return (
    <AppShell
      sections={sections}
      root="/empresa"
      subtitle={ctx.company.name}
      user={shell.user}
      notifications={shell.notifications}
      mobileTabs={tabs}
      searchHref={can(ctx, "employees.view") ? "/empresa/colaboradores" : undefined}
    >
      {children}
    </AppShell>
  );
}
