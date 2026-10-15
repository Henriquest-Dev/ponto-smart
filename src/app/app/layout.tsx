import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import type { NavSection } from "@/components/shell/nav-types";
import { requireEmployee } from "@/lib/auth/context";
import { shellData } from "@/lib/shell";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireEmployee();
  if (ctx.mfaSetupRequired) redirect("/conta/seguranca");
  const shell = await shellData(ctx, "app");
  const sections: NavSection[] = [
    {
      items: [
        { href: "/app", label: "Início", icon: "home" },
        { href: "/app/marcar", label: "Marcar ponto", icon: "scan" },
        { href: "/app/historico", label: "Histórico", icon: "history" },
        { href: "/app/justificacoes", label: "Justificações", icon: "file" },
        { href: "/app/recibos", label: "Recibos", icon: "receipt" },
        { href: "/app/perfil", label: "Perfil", icon: "user" },
      ],
    },
  ];
  return (
    <AppShell
      sections={sections}
      root="/app"
      subtitle={ctx.company.name}
      user={shell.user}
      notifications={shell.notifications}
      centerAction={{ href: "/app/marcar", label: "Marcar ponto" }}
      mobileTabs={[
        { href: "/app", label: "Início", icon: "home" },
        { href: "/app/historico", label: "Histórico", icon: "history" },
        { href: "/app/justificacoes", label: "Faltas", icon: "file" },
        { href: "/app/recibos", label: "Recibos", icon: "receipt" },
      ]}
    >
      {children}
    </AppShell>
  );
}
