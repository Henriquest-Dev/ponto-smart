import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/nav-types";
import { requireContext } from "@/lib/auth/context";
import { shellData } from "@/lib/shell";
import { pendingRequestCount } from "@/lib/queries/platform";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext("platform.companies.manage");
  const [shell, pending] = await Promise.all([shellData(ctx, "admin"), pendingRequestCount()]);
  const sections: NavSection[] = [
    {
      items: [
        { href: "/admin", label: "Painel", icon: "dashboard" },
        { href: "/admin/empresas", label: "Empresas", icon: "building", badge: pending || undefined },
        { href: "/admin/planos", label: "Planos", icon: "layers" },
        { href: "/admin/facturacao", label: "Facturação", icon: "receipt" },
        { href: "/admin/saude", label: "Saúde do serviço", icon: "activity" },
      ],
    },
  ];
  return (
    <AppShell
      sections={sections}
      root="/admin"
      subtitle="Plataforma"
      user={shell.user}
      notifications={shell.notifications}
      mobileTabs={sections[0].items.slice(0, 4)}
    >
      {children}
    </AppShell>
  );
}
