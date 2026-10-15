"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { approveRequestAction } from "@/app/admin/actions";

/** Aprovação de um pedido: cria a empresa e as credenciais do proprietário (mostradas uma vez). */
export function ApproveRequest({ requestId, company, email, planId, plans }: { requestId: string; company: string; email: string; planId: string | null; plans: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ pwd: string | null } | null>(null);
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && done) router.refresh();
        if (!o) setDone(null);
      }}
    >
      <DialogTrigger asChild><Button size="sm">Aprovar</Button></DialogTrigger>
      <DialogContent title={done ? "Conta criada" : `Aprovar ${company}`} description={done ? undefined : "Cria a empresa, a subscrição e a conta do proprietário."}>
        {done ? (
          done.pwd ? (
            <Notice tone="warning" title="Credenciais do proprietário (mostradas uma vez)">
              <p className="mt-2">Login: <span className="font-mono">{email}</span></p>
              <div className="mt-2 flex items-center justify-between rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                {done.pwd}
                <button onClick={() => { void navigator.clipboard.writeText(`${email} / ${done.pwd}`); toast.success("Copiado."); }} aria-label="Copiar"><Copy className="size-4" /></button>
              </div>
              <p className="mt-2">Envie por canal seguro. O proprietário deve alterar a palavra-passe no primeiro acesso e depois criar as credenciais da equipa.</p>
            </Notice>
          ) : (
            <Notice tone="info">O email já tinha conta; foi associado como proprietário da nova empresa.</Notice>
          )
        ) : (
          <ActionForm action={approveRequestAction} onSuccess={(r) => r.ok && setDone({ pwd: (r.data?.temporaryPassword as string | null) ?? null })} className="space-y-4">
            <input type="hidden" name="requestId" value={requestId} />
            <Field label="Plano">
              <Select name="planId" defaultValue={planId ?? plans[0]?.id}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Dias experimentais" hint="0 = activa de imediato"><Input name="trialDays" type="number" min={0} max={90} defaultValue={30} /></Field>
            <SubmitButton className="w-full">Criar conta da empresa</SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
