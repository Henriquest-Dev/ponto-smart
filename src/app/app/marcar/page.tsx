"use client";

import { clockState, useTitle, type MyStatus } from "@/components/collab/shared";
import { Notice } from "@/components/ui/misc";
import { extractQrToken } from "@/lib/domain/qr-client";
import { rpc } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData, useQueryParam } from "@/lib/sb/use-data";
import { ClockFlow } from "./clock-flow";

export default function ClockPage() {
  useTitle("Marcar ponto");
  const { company, companyId, tz } = useCompany();
  const t = useQueryParam("t");
  const link = useQueryParam("link");
  const tipo = useQueryParam("tipo");
  const status = useData(() => rpc<MyStatus>("ps_my_status", { p_company: companyId }), [companyId]);
  const state = status.data ? clockState(status.data) : null;

  return (
    <>
      {status.error ? (
        <div className="mx-auto max-w-md px-4 pt-4">
          <Notice tone="warning">{status.error}</Notice>
        </div>
      ) : null}
      <ClockFlow
        initialToken={t ? extractQrToken(t) : null}
        initialLink={link}
        state={state}
        wantsBreak={tipo === "intervalo" && state !== "off" && state !== "break"}
        timeZone={tz}
        devicePolicy={company.settings.devicePolicy ?? "warn"}
      />
    </>
  );
}
