"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hasModule } from "@/lib/manager-modules";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { loadStock, STOCK_STATE } from "./stock";

/** Cartões de gestão no início do gerente: materiais a acabar e procura rápida de viaturas. */
export function ManagerHome() {
  const { company, companyId } = useCompany();
  const router = useRouter();
  const workshop = hasModule(company, "oficina");
  const stock = useData(() => loadStock(companyId), [companyId]);
  const alerts = (stock.data ?? []).filter((i) => i.state !== "ok");
  const [plate, setPlate] = React.useState("");

  return (
    <section className={workshop ? "grid gap-4 lg:grid-cols-2" : ""}>
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold">Estoque</p>
          <Button asChild size="sm" variant="soft">
            <Link href="/app/estoque/">Abrir estoque</Link>
          </Button>
        </div>
        {stock.error ? <p className="mt-3 text-[13px] text-danger">{stock.error}</p> : null}
        {stock.data ? (
          alerts.length ? (
            <ul className="mt-3 divide-y divide-border">
              {alerts.slice(0, 5).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                  <span className="min-w-0 truncate font-bold">{i.name}</span>
                  <span className="flex shrink-0 items-center gap-2 tabular">
                    {Number(i.quantity).toLocaleString("pt-PT")} {i.unit}
                    <Badge tone={STOCK_STATE[i.state].tone}>{STOCK_STATE[i.state].label}</Badge>
                  </span>
                </li>
              ))}
              {alerts.length > 5 ? <li className="pt-2 text-[12.5px] text-muted">E mais {alerts.length - 5}.</li> : null}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">
              {stock.data.length ? "Nenhum material a acabar." : "Ainda sem materiais. Adicione-os no estoque."}
            </p>
          )
        ) : null}
      </Card>
      {workshop ? (
        <Card className="p-5 sm:p-6">
          <p className="text-[15px] font-bold">Procurar viatura</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Escreva a matrícula, o modelo ou o proprietário.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/app/oficina/?q=${encodeURIComponent(plate.trim())}`);
            }}
          >
            <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Ex.: AAA 123 MC" aria-label="Matrícula" className="font-mono uppercase placeholder:font-sans placeholder:normal-case" />
            <Button type="submit">Procurar</Button>
          </form>
        </Card>
      ) : null}
    </section>
  );
}
