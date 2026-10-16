"use client";

import * as React from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock, NoAccess } from "@/components/company/p2-shared";
import { useTitle } from "@/components/collab/shared";
import { sendMail } from "@/components/mail/send";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { must, sb } from "@/lib/sb/client";
import { useCompany } from "@/lib/sb/session";
import { useData } from "@/lib/sb/use-data";
import { cn } from "@/lib/utils";

type Person = { id: string; full_name: string; email: string | null; department_id: string | null; job_title: string | null };
type Mode = "todos" | "departamento" | "escolher";

/** Comunicados: a empresa escreve aos colaboradores e o Horbit envia por email (com os dados da empresa). */
export default function MessagesPage() {
  useTitle("Comunicados");
  const { can } = useCompany();
  if (!can("employees.manage")) return <NoAccess title="Comunicados" />;
  return <Messages />;
}

function Messages() {
  const { companyId, company } = useCompany();
  const data = useData(async () => {
    const [e, d] = await Promise.all([
      sb().from("employees").select("id,full_name,email,department_id,job_title").eq("company_id", companyId).eq("status", "active").order("full_name").then(must),
      sb().from("departments").select("id,name").eq("company_id", companyId).order("name").then(must),
    ]);
    return { people: (e ?? []) as Person[], departments: (d ?? []) as { id: string; name: string }[] };
  }, [companyId]);
  const [mode, setMode] = React.useState<Mode>("todos");
  const [dept, setDept] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [q, setQ] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ sent: number; subject: string } | null>(null);

  const people = data.data?.people ?? [];
  const chosen = mode === "todos" ? people : mode === "departamento" ? people.filter((p) => p.department_id === dept) : people.filter((p) => picked.includes(p.id));
  const withEmail = chosen.filter((p) => p.email?.includes("@"));
  const without = chosen.filter((p) => !p.email?.includes("@"));
  const t = q.trim().toLowerCase();
  const listed = t ? people.filter((p) => p.full_name.toLowerCase().includes(t) || (p.email ?? "").toLowerCase().includes(t)) : people;

  const send = async () => {
    if (!withEmail.length) return toast.error("Nenhum dos destinatários tem email na ficha.");
    if (subject.trim().length < 3) return toast.error("Escreva o assunto.");
    if (text.trim().length < 5) return toast.error("Escreva a mensagem.");
    if (!window.confirm(`Enviar "${subject.trim()}" a ${withEmail.length} ${withEmail.length === 1 ? "pessoa" : "pessoas"}?`)) return;
    setBusy(true);
    const r = await sendMail({
      companyId,
      kind: "company",
      to: [...new Set(withEmail.map((p) => p.email!.trim().toLowerCase()))],
      data: { subject: subject.trim(), text: text.trim() },
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setDone({ sent: r.sent ?? withEmail.length, subject: subject.trim() });
    toast.success("Comunicado enviado.");
    setSubject("");
    setText("");
  };

  return (
    <>
      <PageHeader
        title="Comunicados"
        description={`Escreva aos colaboradores: o Horbit envia por email, com o nome e os contactos da ${company.companyName}.`}
      />
      <PageBody className="max-w-4xl">
        {data.error ? <ErrorBlock message={data.error} /> : null}
        {!data.data && !data.error ? <LoadingBlock rows={4} /> : null}
        {done ? (
          <Notice tone="success" title="Comunicado enviado">
            &quot;{done.subject}&quot; seguiu para {done.sent} {done.sent === 1 ? "pessoa" : "pessoas"}. As respostas chegam ao seu email (ou ao da empresa).
          </Notice>
        ) : null}
        {data.data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Mensagem</CardTitle>
                  <CardDescription>Chega com o nome Horbit e, no fim, os dados da empresa.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Assunto" htmlFor="msg-subject">
                  <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="Ex.: Horário de fim de ano" />
                </Field>
                <Field label="Mensagem" hint="Deixe uma linha em branco entre parágrafos." htmlFor="msg-text">
                  <Textarea id="msg-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-48" maxLength={8000} placeholder={"Olá a todos,\n\nNo dia 24 a loja fecha às 13:00…"} />
                </Field>
                <Button size="lg" className="w-full" disabled={busy || !withEmail.length} onClick={() => void send()}>
                  {busy ? <span className="spinner" aria-hidden /> : null}
                  Enviar a {withEmail.length} {withEmail.length === 1 ? "pessoa" : "pessoas"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Para quem</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Tabs
                  items={[
                    { key: "todos", label: "Todos" },
                    { key: "departamento", label: "Departamento" },
                    { key: "escolher", label: "Escolher" },
                  ]}
                  active={mode}
                  onChange={setMode}
                />
                {mode === "departamento" ? (
                  <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Departamento">
                    <option value="">Escolher departamento…</option>
                    {data.data.departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                ) : null}
                {mode === "escolher" ? (
                  <>
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar colaborador" aria-label="Procurar colaborador" />
                    <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {listed.map((p) => (
                        <li key={p.id}>
                          <label className={cn("flex items-center gap-2.5 px-3 py-2 text-[13.5px]", !p.email && "opacity-60")}>
                            <Checkbox checked={picked.includes(p.id)} onChange={(e) => setPicked((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
                            <span className="min-w-0">
                              <span className="block truncate font-bold">{p.full_name}</span>
                              <span className="block truncate text-[12px] text-muted">{p.email ?? "Sem email"}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <p className="text-[13px]">
                  <b>{withEmail.length}</b> {withEmail.length === 1 ? "pessoa recebe" : "pessoas recebem"} o email.
                </p>
                {without.length ? (
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-[#6f4100]">
                    Sem email na ficha ({without.length}): {without.slice(0, 6).map((p) => p.full_name).join(", ")}
                    {without.length > 6 ? "…" : ""}. Escreva o email na ficha para também receberem.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
