"use client";

import { Check, Download, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { one, type MyPayslip, type One } from "@/components/collab/shared";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { renderPayslipPdf } from "@/lib/domain/payroll/payslip-pdf";
import { attempt } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";

export function AcknowledgeButton({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <ActionButton
      size="sm"
      variant="soft"
      action={() =>
        attempt(async () => {
          await rpc("ps_ack_payslip", { p_payslip: id });
          onDone();
          return "Recepção confirmada.";
        })
      }
    >
      <Check /> Confirmar recepção
    </ActionButton>
  );
}

type EmployeeRow = {
  full_name: string;
  employee_code: string;
  job_title: string | null;
  nuit: string | null;
  departments: One<{ name: string }>;
};

/** Gera o PDF do recibo no navegador (pdf-lib) a partir dos dados visíveis ao colaborador. */
async function buildPdf(slip: MyPayslip, companyId: string, employeeId: string) {
  const [company, employee, lines] = await Promise.all([
    sb().from("companies").select("name,legal_name,nuit,address").eq("id", companyId).single().then(must),
    sb().from("employees").select("full_name,employee_code,job_title,nuit,departments(name)").eq("id", employeeId).single().then(must),
    sb()
      .from("payroll_lines")
      .select("code,description,nature,quantity,amount,sort")
      .eq("payroll_item_id", slip.itemId)
      .order("sort", { ascending: true })
      .then(must),
  ]);
  const c = company as { name: string; legal_name: string | null; nuit: string | null; address: string | null };
  const e = employee as unknown as EmployeeRow;
  return renderPayslipPdf({
    reference: slip.reference,
    company: { name: c.legal_name ?? c.name, nuit: c.nuit, address: c.address },
    employee: { name: e.full_name, code: e.employee_code, jobTitle: e.job_title, nuit: e.nuit, department: one(e.departments)?.name ?? null },
    period: { year: slip.year, month: slip.month },
    run: {
      version: slip.run?.version ?? 1,
      engineVersion: slip.run?.engineVersion ?? "—",
      inputHash: slip.run?.inputHash ?? "",
      approvedAt: slip.run?.approvedAt ? new Date(slip.run.approvedAt) : null,
    },
    currency: slip.currency,
    lines: ((lines ?? []) as { code: string; description: string; nature: "earning" | "deduction"; quantity: string | null; amount: string }[]).map(
      (l) => ({ code: l.code, description: l.description, nature: l.nature, quantity: l.quantity, amount: String(l.amount) }),
    ),
    gross: slip.gross,
    deductions: slip.deductions,
    net: slip.net,
    issuedAt: new Date(slip.issuedAt),
  });
}

export function DownloadPayslip({ slip, companyId, employeeId }: { slip: MyPayslip; companyId: string; employeeId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const bytes = await buildPdf(slip, companyId, employeeId);
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `recibo-${slip.reference}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Não foi possível gerar o PDF.");
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Download />} PDF
    </Button>
  );
}
