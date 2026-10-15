import { and, count, desc, eq, ilike } from "drizzle-orm";
import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { requireCompany } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Auditoria" };
const PAGE = 30;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; p?: string }> }) {
  const ctx = await requireCompany("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.p) || 1);
  const where = and(eq(auditLogs.companyId, ctx.company.id), sp.q ? ilike(auditLogs.action, `%${sp.q}%`) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ a: auditLogs, actor: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);
  return (
    <>
      <PageHeader title="Auditoria" description="Trilho imutável de acções: quem, o quê, quando e de onde." />
      <PageBody>
        <form className="flex gap-2 sm:max-w-md">
          <Input name="q" defaultValue={sp.q} placeholder="Filtrar por acção (ex.: payroll, absence, auth)" />
          <Button type="submit" variant="soft">Filtrar</Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Sem registos" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr><TH>Quando</TH><TH>Utilizador</TH><TH>Acção</TH><TH>Entidade</TH><TH>Detalhe</TH><TH>IP</TH></tr>
              </THead>
              <tbody>
                {rows.map(({ a, actor }) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap text-muted tabular">{formatDateTime(a.createdAt, ctx.company.timezone)}</TD>
                    <TD>{actor ?? "Sistema"}</TD>
                    <TD className="font-mono text-xs">{a.action}</TD>
                    <TD className="text-xs text-muted">{a.entity}{a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ""}</TD>
                    <TD className="max-w-xs truncate font-mono text-[11px] text-muted" title={a.after ? JSON.stringify(a.after) : ""}>{a.after ? JSON.stringify(a.after) : "—"}</TD>
                    <TD className="text-xs text-muted">{a.ip ?? "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} hrefFor={(p) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), p: String(p) })}`} />
      </PageBody>
    </>
  );
}
