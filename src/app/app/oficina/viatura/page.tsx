"use client";

import { NoAccess } from "@/components/company/p2-shared";
import { VehiclePage } from "@/components/manager/workshop";
import { useTitle } from "@/components/collab/shared";
import { hasModule } from "@/lib/manager-modules";
import { useCompany } from "@/lib/sb/session";

export default function Page() {
  useTitle("Viatura");
  const { can, company } = useCompany();
  if (!can("workshop.manage") || !hasModule(company, "oficina")) return <NoAccess title="Oficina" />;
  return <VehiclePage base="/app" />;
}
