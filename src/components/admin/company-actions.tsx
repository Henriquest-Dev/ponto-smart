"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field } from "@/components/ui/input";
import { attempt } from "@/lib/result";
import { errorMessage, rpc } from "@/lib/sb/client";
import { PasswordInput } from "./company-form";
import { CredentialsPanel, type Credentials } from "./credentials";
import { generatePassword, type AdminCompany, type CompanyStatus, type Plan } from "./data";

const STATUS_ACTIONS: { status: CompanyStatus; label: string; confirm?: (n: string) => string; done: string }[] = [
  { status: "active", label: "Activar", done: "Empresa activa." },
  { status: "trial", label: "Marcar como experimental", done: "Empresa em período experimental." },
  {
    status: "suspended",
    label: "Suspender",
   
    confirm: (n) => `Suspender ${n}? Os utilizadores da empresa deixam de ter acesso até ser reactivada.`,
    done: "Empresa suspensa: os utilizadores deixam de ter acesso.",
  },
  {
    status: "cancelled",
    label: "Cancelar conta",
   
    confirm: (n) => `Cancelar a conta de ${n}? Os utilizadores perdem o acesso. Os dados mantêm-se e pode reactivar depois.`,
    done: "Conta cancelada.",
  },
];

/** Menu de acções de uma empresa: estado e reposição do acesso do responsável. */
export function CompanyActions({ company, plans = [], onChanged }: { company: AdminCompany; plans?: Plan[]; onChanged: () => void }) {
  const [resetOpen, setResetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function setStatus(a: (typeof STATUS_ACTIONS)[number]) {
    if (a.confirm && !window.confirm(a.confirm(company.name))) return;
    setBusy(true);
    try {
      await rpc("ps_admin_set_company_status", { p_company: company.id, p_status: a.status });
      toast.success(a.done);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setPlan(p: Plan) {
    if (!window.confirm(`Mudar ${company.name} para o plano ${p.name}?`)) return;
    setBusy(true);
    try {
      await rpc("ps_admin_set_plan", { p_company: company.id, p_plan_code: p.code });
      toast.success(`Plano alterado para ${p.name}.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`Acções para ${company.name}`} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            Acções
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownLabel>Estado da empresa</DropdownLabel>
          {STATUS_ACTIONS.filter((a) => a.status !== company.status).map((a) => (
            <DropdownItem
              key={a.status}
              onSelect={() => void setStatus(a)}
              className={a.status === "suspended" || a.status === "cancelled" ? "text-danger" : undefined}
            >
              {a.label}
            </DropdownItem>
          ))}
          {plans.filter((p) => p.active && p.code !== company.plan_code).length ? (
            <>
              <DropdownSeparator />
              <DropdownLabel>Mudar de plano</DropdownLabel>
              {plans
                .filter((p) => p.active && p.code !== company.plan_code)
                .map((p) => (
                  <DropdownItem key={p.code} onSelect={() => void setPlan(p)}>
                    {p.name}
                  </DropdownItem>
                ))}
            </>
          ) : null}
          <DropdownSeparator />
          <DropdownItem onSelect={() => setResetOpen(true)} disabled={!company.owner_login}>
            Nova palavra-passe do responsável
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <ResetOwnerPassword company={company} open={resetOpen} onOpenChange={setResetOpen} />
    </>
  );
}

function ResetOwnerPassword({ company, open, onOpenChange }: { company: AdminCompany; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [creds, setCreds] = React.useState<Credentials | null>(null);
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (open) setPassword(generatePassword());
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCreds(null);
      }}
    >
      <DialogContent
        title={creds ? "Nova palavra-passe definida" : "Nova palavra-passe do responsável"}
        description={creds ? undefined : `${company.name}, acesso ${company.owner_login ?? "—"}. A palavra-passe actual deixa de funcionar.`}
      >
        {creds ? (
          <CredentialsPanel creds={creds} onClose={() => onOpenChange(false)} />
        ) : (
          <ActionForm
            resetOnSuccess={false}
            action={() =>
              attempt(async () => {
                if (password.length < 8) throw new Error("A palavra-passe deve ter pelo menos 8 caracteres.");
                const login = await rpc<string>("ps_admin_reset_owner_password", { p_company: company.id, p_password: password });
                const data: Credentials = { company: company.name, login: login ?? company.owner_login ?? "", password };
                return { ok: true, message: "Palavra-passe alterada.", data };
              })
            }
            onSuccess={(r) => {
              if (r.ok && r.data) setCreds(r.data as Credentials);
            }}
            className="space-y-4"
          >
            <Field label="Palavra-passe" hint="Mínimo 8 caracteres.">
              <PasswordInput value={password} onChange={setPassword} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <SubmitButton pendingText="A guardar…">Definir palavra-passe</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
