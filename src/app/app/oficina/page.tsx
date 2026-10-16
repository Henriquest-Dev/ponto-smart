"use client";

import { NoAccess } from "@/components/company/p2-shared";
import { WorkshopPage } from "@/components/manager/workshop";
import { useTitle } from "@/components/collab/shared";
import { hasModule } from "@/lib/manager-modules";
import { useCompany } from "@/lib/sb/session";

export default function Page() {
  useTitle("Oficina");
  const { can, company } = useCompany();
  if (!can("workshop.manage") || !hasModule(company, "oficina")) return <NoAccess title="Oficina" />;
  return <WorkshopPage base="/app" />;
}
