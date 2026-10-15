import type { Metadata } from "next";
import { requireEmployee } from "@/lib/auth/context";
import { currentState } from "@/lib/queries/employee";
import { ClockFlow } from "./clock-flow";

export const metadata: Metadata = { title: "Marcar ponto" };

export default async function ClockPage({ searchParams }: { searchParams: Promise<{ t?: string; tipo?: string }> }) {
  const ctx = await requireEmployee();
  const { t, tipo } = await searchParams;
  const { state } = await currentState(ctx.company.id, ctx.employee.id);
  return (
    <ClockFlow
      initialToken={t ?? null}
      state={state}
      wantsBreak={tipo === "intervalo" && state === "working"}
      timeZone={ctx.company.timezone}
      devicePolicy={ctx.company.settings.devicePolicy}
    />
  );
}
