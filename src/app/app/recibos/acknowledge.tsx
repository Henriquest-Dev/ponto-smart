"use client";

import { Check } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acknowledgePayslipAction } from "../actions";

export function AcknowledgeButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="soft"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await acknowledgePayslipAction(id);
          if (r.ok) toast.success(r.message ?? "Confirmado.");
          else toast.error(r.error);
        })
      }
    >
      <Check /> Confirmar recepção
    </Button>
  );
}
