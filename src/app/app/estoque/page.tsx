"use client";

import { NoAccess } from "@/components/company/p2-shared";
import { StockPage } from "@/components/manager/stock";
import { useTitle } from "@/components/collab/shared";
import { useCompany } from "@/lib/sb/session";

export default function Page() {
  useTitle("Estoque");
  const { can, company } = useCompany();
  if (company.role !== "manager" || !can("stock.manage")) return <NoAccess title="Estoque" />;
  return <StockPage />;
}
