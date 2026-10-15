"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/input";
import { decideAbsenceAction } from "./actions";

export function DecideAbsence({ requestId, name }: { requestId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Decidir</Button>
      </DialogTrigger>
      <DialogContent title="Decidir justificação" description={`${name}. A decisão deve ser fundamentada e é comunicada ao colaborador.`}>
        <ActionForm action={decideAbsenceAction} onSuccess={() => setOpen(false)} className="space-y-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value={decision} />
          <div className="grid grid-cols-2 gap-2">
            {(["approved", "rejected"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecision(d)}
                className={`h-11 rounded-md border text-[13px] font-medium ${
                  decision === d ? (d === "approved" ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger") : "border-border-strong text-muted"
                }`}
              >
                {d === "approved" ? "Aprovar" : "Recusar"}
              </button>
            ))}
          </div>
          <Field label="Fundamento">
            <Textarea name="reason" required minLength={3} placeholder={decision === "approved" ? "Ex.: atestado médico verificado." : "Ex.: documento não corresponde às datas indicadas."} />
          </Field>
          <SubmitButton className="w-full" variant={decision === "approved" ? "primary" : "danger"}>
            Confirmar {decision === "approved" ? "aprovação" : "recusa"}
          </SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
