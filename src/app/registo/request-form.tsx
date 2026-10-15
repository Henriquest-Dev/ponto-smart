"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { PendingButton, SubmitForm } from "@/components/admin/submit-form";
import { FloatField } from "@/components/brand/float-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { attempt, formObject, type ActionResult } from "@/lib/result";
import { must, rpc, sb } from "@/lib/sb/client";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type PublicPlan = { code: string; name: string; price_monthly: number | string; currency: string; max_employees: number };

async function submit(fd: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const o = formObject(fd);
    // Armadilha anti-spam: campo invisível que só os robôs preenchem.
    if (o.website) return { ok: true };
    if (!o.company_name || o.company_name.length < 2) throw new Error("Indique o nome da empresa.");
    if (!o.contact_name || o.contact_name.length < 3) throw new Error("Indique o nome do responsável.");
    const employees = o.employees ? Number(o.employees) : null;
    await rpc("ps_submit_company_request", {
      p_company_name: o.company_name,
      p_contact_name: o.contact_name,
      p_email: (o.email ?? "").toLowerCase(),
      p_phone: o.phone ?? null,
      p_nuit: o.nuit ?? null,
      p_city: o.city ?? null,
      p_employees: employees && Number.isInteger(employees) && employees > 0 ? employees : null,
      p_plan_code: o.plan_code ?? null,
      p_message: o.message ?? null,
    });
    return { ok: true };
  });
}

/** "2 500 MZN": milhares sempre agrupados com espaço fino, sem casas decimais quando inteiro. */
function planPrice(value: number | string, currency: string) {
  const n = Number(value) || 0;
  const [int, dec] = (Number.isInteger(n) ? String(n) : n.toFixed(2)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}${dec ? `,${dec}` : ""} ${currency}`;
}

export function RequestForm() {
  const wanted = useSearchParams().get("plano");
  const reduce = useReducedMotion();
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const plans = useData(
    async () =>
      must(
        await sb()
          .from("subscription_plans")
          .select("code,name,price_monthly,currency,max_employees")
          .eq("active", true)
          .order("price_monthly"),
      ) as PublicPlan[],
    [],
  );

  const list = plans.data ?? [];
  const fallback = list.find((p) => p.code === wanted)?.code ?? list[1]?.code ?? list[0]?.code ?? "";
  const selected = picked ?? fallback;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {sent ? (
        <motion.div
          key="sent"
          role="status"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          className="py-6"
        >
          <div className="flex items-end gap-1.5" aria-hidden>
            {[28, 44, 64].map((h, i) => (
              <motion.span
                key={h}
                className="block w-2.5 rounded-full bg-success"
                initial={reduce ? false : { height: 0 }}
                animate={{ height: h }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.45, ease: [0.2, 0.9, 0.3, 1.2] }}
              />
            ))}
          </div>
          <h1 className="mt-8 text-[32px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[38px]">Pedido enviado</h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
            Recebemos o pedido. A equipa Horbit cria a conta da empresa e envia-lhe o utilizador e a palavra-passe do responsável.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button size="lg" asChild>
              <Link href="/">Voltar à página inicial</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link href="/login/">Entrar</Link>
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="form" exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
          <SubmitForm
            onSubmit={(fd) => {
              setError(null);
              return submit(fd);
            }}
            onSuccess={() => setSent(true)}
            onError={setError}
            className="space-y-8"
          >
            <div>
              <motion.h1
                className="text-[32px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[38px]"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                Pedir conta para a empresa
              </motion.h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Escolha o plano e deixe os contactos. Validamos o pedido e criamos o acesso do responsável.
              </p>
            </div>

            <AnimatePresence initial={false}>
              {error ? (
                <motion.div
                  key={error}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                  role="alert"
                >
                  <p className="flex gap-2.5 rounded-[16px] bg-danger-soft px-4 py-3 text-[13.5px] font-bold text-[#8e1f27]">
                    <span className="stem mt-0.5 h-4 shrink-0 text-danger" aria-hidden />
                    {error}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <fieldset>
              <legend className="mb-3 text-[17px] font-extrabold tracking-[-0.01em]">Plano</legend>
              {plans.loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-[76px] rounded-[18px]" />
                  ))}
                </div>
              ) : list.length ? (
                <div className="space-y-2" role="radiogroup" aria-label="Plano">
                  {list.map((p) => {
                    const on = p.code === selected;
                    return (
                      <label
                        key={p.code}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-4 rounded-[18px] border-2 px-4 py-4 transition-colors duration-150 sm:px-5",
                          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                          on ? "border-primary bg-primary-soft/50" : "border-border hover:border-border-strong",
                        )}
                      >
                        <input
                          type="radio"
                          name="plan_code"
                          value={p.code}
                          checked={on}
                          onChange={() => setPicked(p.code)}
                          className="sr-only"
                        />
                        <motion.span
                          aria-hidden
                          className={cn("block w-1.5 shrink-0 rounded-full", on ? "bg-primary" : "bg-border-strong")}
                          animate={{ height: on ? 36 : 14 }}
                          transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[17px] font-extrabold tracking-[-0.01em]">{p.name}</span>
                          <span className="block text-[13px] text-muted">Até {p.max_employees} colaboradores</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-[17px] font-extrabold whitespace-nowrap tabular">{planPrice(p.price_monthly, p.currency)}</span>
                          <span className="block text-[12.5px] text-muted">por mês</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[18px] bg-surface px-4 py-4 text-[13.5px] text-muted">
                  {plans.error
                    ? "Não foi possível carregar os planos. Pode enviar o pedido e combinamos o plano consigo."
                    : "O plano é combinado com a equipa Horbit depois do pedido."}
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-3 text-[17px] font-extrabold tracking-[-0.01em]">Empresa</legend>
              <FloatField label="Nome da empresa" name="company_name" required minLength={2} maxLength={160} autoComplete="organization" />
              <div className="grid gap-3 sm:grid-cols-2">
                <FloatField label="NUIT" name="nuit" inputMode="numeric" maxLength={20} />
                <FloatField label="Cidade" name="city" defaultValue="Maputo" maxLength={80} autoComplete="address-level2" />
              </div>
              <FloatField label="Número de colaboradores" name="employees" type="number" min={1} max={100000} inputMode="numeric" />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-3 text-[17px] font-extrabold tracking-[-0.01em]">Responsável</legend>
              <FloatField label="Nome do responsável" name="contact_name" required minLength={3} maxLength={120} autoComplete="name" />
              <div className="grid gap-3 sm:grid-cols-2">
                <FloatField label="Email" name="email" type="email" required autoComplete="email" />
                <FloatField label="Telefone" name="phone" type="tel" maxLength={30} autoComplete="tel" />
              </div>
              <div>
                <label htmlFor="request-message" className="mb-1.5 block px-1 text-[13px] font-bold">
                  Mensagem <span className="font-normal text-muted">(opcional)</span>
                </label>
                <Textarea
                  id="request-message"
                  name="message"
                  maxLength={1000}
                  placeholder="Filiais, turnos ou necessidades específicas"
                  className="rounded-[18px] px-5 py-4 text-[15px]"
                />
              </div>
            </fieldset>

            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

            <div>
              <PendingButton size="lg" className="h-14 w-full text-[16px] font-extrabold" pendingText="A enviar o pedido…">
                Enviar pedido
              </PendingButton>
            </div>
          </SubmitForm>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
