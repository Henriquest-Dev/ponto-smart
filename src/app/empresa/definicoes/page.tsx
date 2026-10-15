import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { can, requireCompany } from "@/lib/auth/context";
import { ROLES, type RoleCode } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { branches, companies, departments, memberships, roles, users } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { AddBranch, AddDepartment, CompanyForm, DepartmentManager, InviteUser, RoleSelect } from "./forms";

export const metadata: Metadata = { title: "Definições" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCompany("company.settings.manage", "users.manage", "org.manage");
  const { tab: t } = await searchParams;
  const tabs = [
    ...(can(ctx, "company.settings.manage") ? [{ key: "empresa", label: "Empresa e políticas", href: "?tab=empresa" }] : []),
    ...(can(ctx, "users.manage") ? [{ key: "utilizadores", label: "Utilizadores e papéis", href: "?tab=utilizadores" }] : []),
    ...(can(ctx, "org.manage") ? [{ key: "organizacao", label: "Filiais e departamentos", href: "?tab=organizacao" }] : []),
  ];
  const tab = tabs.find((x) => x.key === t)?.key ?? tabs[0].key;
  const tz = ctx.company.timezone;

  let body: React.ReactNode = null;
  if (tab === "empresa") {
    const [c] = await db.select().from(companies).where(eq(companies.id, ctx.company.id)).limit(1);
    body = <CompanyForm company={{ name: c.name, legalName: c.legalName, nuit: c.nuit, email: c.email, phone: c.phone, address: c.address, timezone: c.timezone, currency: c.currency, settings: c.settings }} />;
  } else if (tab === "utilizadores") {
    const members = await db
      .select({ id: memberships.id, active: memberships.active, role: roles.code, name: users.name, email: users.email, mfa: users.mfaEnabled, lastLogin: users.lastLoginAt, userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.companyId, ctx.company.id))
      .orderBy(asc(users.name));
    body = (
      <div className="space-y-5">
        <div className="flex justify-end"><InviteUser canOwner={ctx.role === "owner"} /></div>
        <TableWrap>
          <Table>
            <THead><tr><TH>Utilizador</TH><TH>Papel</TH><TH>MFA</TH><TH>Último acesso</TH><TH>Estado</TH></tr></THead>
            <tbody>
              {members.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} size={30} />
                      <span className="min-w-0"><span className="block font-medium">{m.name}</span><span className="block text-xs text-muted">{m.email}</span></span>
                    </div>
                  </TD>
                  <TD>{m.userId === ctx.user.id ? <Badge tone="primary">{ROLE_LABEL[m.role]}</Badge> : <RoleSelect membershipId={m.id} role={m.active ? m.role : "disabled"} canOwner={ctx.role === "owner"} />}</TD>
                  <TD>{m.mfa ? <Badge tone="success">Activo</Badge> : <Badge>—</Badge>}</TD>
                  <TD className="text-muted">{m.lastLogin ? formatDateTime(m.lastLogin, tz) : "Nunca"}</TD>
                  <TD>{m.active ? <Badge tone="success">Activo</Badge> : <Badge tone="danger">Desactivado</Badge>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <Card>
          <CardHeader><div><CardTitle>Papéis e permissões</CardTitle><CardDescription>Princípio do privilégio mínimo. A separação de funções impede quem prepara salários de os aprovar.</CardDescription></div></CardHeader>
          <CardContent>
            <ul className="grid gap-3 md:grid-cols-2">
              {(Object.keys(ROLES) as RoleCode[]).filter((r) => r !== "super_admin").map((r) => (
                <li key={r} className="rounded-lg border border-border p-3">
                  <p className="text-[13px] font-semibold">{ROLES[r].name}</p>
                  <p className="text-xs text-muted">{ROLES[r].description}</p>
                  <p className="mt-2 text-[11px] text-subtle">{ROLES[r].permissions.length} permissões</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  } else {
    const [b, d, managers] = await Promise.all([
      db.select().from(branches).where(eq(branches.companyId, ctx.company.id)).orderBy(asc(branches.name)),
      db.select().from(departments).where(eq(departments.companyId, ctx.company.id)).orderBy(asc(departments.name)),
      db
        .select({ id: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.companyId, ctx.company.id))
        .orderBy(asc(users.name)),
    ]);
    body = (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Filiais</CardTitle><AddBranch /></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {b.map((x) => (
                <li key={x.id} className="py-3 text-[13px]"><span className="font-medium">{x.name}</span><span className="block text-xs text-muted">{[x.address, x.city].filter(Boolean).join(", ") || "—"}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Departamentos</CardTitle><CardDescription>O supervisor responsável vê e valida apenas a equipa do departamento.</CardDescription></div><AddDepartment branches={b.map((x) => ({ id: x.id, name: x.name }))} managers={managers} /></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {d.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]">
                  <span><span className="font-medium">{x.name}</span><span className="block text-xs text-muted">{b.find((y) => y.id === x.branchId)?.name ?? "Sem filial"}</span></span>
                  <DepartmentManager id={x.id} managerUserId={x.managerUserId} managers={managers} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Definições" />
      <PageBody>
        <LinkTabs items={tabs} active={tab} />
        {body}
      </PageBody>
    </>
  );
}
