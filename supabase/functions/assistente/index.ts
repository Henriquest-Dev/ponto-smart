// Horbit — Edge Function do assistente (Supabase; publicada como "Ponto-ai").
// Super Admin (scope "platform"): conversa sobre a plataforma.
// Empresa (scope "company"): gestor de RH — conversa, análise automática (mode "insights") e propostas de acções
// que o utilizador confirma no ecrã (a função nunca altera dados: só propõe). Mode "notify": avisa o responsável
// (notificação no Horbit e, se houver RESEND_API_KEY, email). Mode "speak": voz neural (Fish Audio pelo OpenRouter,
// segredo OPENROUTER_API_KEY) — o Gemini é o cérebro, o Fish Audio é a voz. Mode "memorize": guarda na memória
// os factos duradouros de uma conversa (preferências, decisões), para o assistente se lembrar nas conversas seguintes.
// Os dados vêm de ps_ai_platform_context / ps_ai_context com o login do próprio utilizador (as regras de acesso aplicam-se).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS = [Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];
/** Se um modelo não começar a responder neste tempo, o pedido vai também para o seguinte (fica o que responder primeiro). */
const HEDGE_MS = 2500;
const GEMINI = Deno.env.get("GEMINI_API_BASE") ?? "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER = Deno.env.get("OPENROUTER_API_BASE") ?? "https://openrouter.ai/api/v1";

type FileIn = { name?: string; mime?: string; data?: string };
type Msg = { role: "user" | "model"; text: string; files?: FileIn[] };
/** Anexos que o Gemini lê directamente (as planilhas e textos chegam já convertidos em texto). */
const FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_FILE_B64 = 11_500_000; // ~8 MB por ficheiro
type Action = { type: string; label: string; args: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
type Ctx = any;

const GUIDE_COMPANY = `Como funciona o Horbit (painel da empresa):
- Painel: quem está presente hoje, atrasos, faltas e gráficos dos últimos 30 dias.
- QR Code (menu QR Code): QR Code dinâmico (num ecrã na entrada, muda a cada poucos segundos) e QR Code fixo (impresso, com horário de validade); o colaborador lê com a câmara e o ponto fica marcado (entrada e depois saída). Não há marcação por link.
- O assistente pode, com confirmação: cessar ou reactivar colaboradores, editar fichas, criar colaboradores, dar/mudar/retirar acessos, gerar palavras-passe, alterar salários, atribuir horários, exportar planilhas, avisar o responsável e abrir páginas. Também ouve comandos de voz e lê as respostas em voz alta.
- Colaboradores: criar colaborador (nome, código, horário, salário, utilizador e palavra-passe, papel). Na ficha: dados, histórico salarial, redefinir palavra-passe, desactivar, relatório do mês.
- Papéis: responsável (owner), administrador, RH, financeiro, supervisor, colaborador.
- Locais e estações: local com morada e raio (geofence) e estações (ecrã da recepção).
- Assiduidade: lista diária; Revisão para decidir marcações duvidosas; Correcções para corrigir horas com motivo.
- Justificações: o colaborador pede com anexo; supervisor e/ou RH aprovam ou recusam com fundamento.
- Relatórios: relatório por colaborador (mês dia a dia) e exportação em Excel.
- Salários: fechar a assiduidade, gerar o pré-processamento, outra pessoa aprova, emitir recibos, registar pagamentos.
- Auditoria: quem fez o quê e quando.`;

const GUIDE_PLATFORM = `Como funciona o Horbit (Super Admin):
- Visão geral: empresas, colaboradores activos, pedidos pendentes e actividade de marcações.
- Pedidos de acesso (menu Plataforma → Pedidos de acesso): as empresas pedem acesso na página pública "Pedir acesso" com só o nome, o email e o motivo. No menu Pedidos de acesso, o Super Admin usa "Pedir dados por email" para pedir o nome do responsável e os dados da empresa; com a resposta usa "Criar conta" (cria a empresa e o acesso do responsável) e depois "Enviar por email" para mandar as credenciais. Também pode recusar com motivo.
- Empresas: criar empresa directamente, ver o responsável, redefinir a palavra-passe do responsável, suspender ou reactivar.
- Auditoria: todas as acções na plataforma.
- O Super Admin não vê salários das empresas. Cada empresa cria os acessos da própria equipa.`;

/** Acções que o assistente da empresa pode propor (o utilizador confirma no ecrã). */
const TOOLS = [
  {
    name: "decidir_justificacao",
    description: "Propor aprovar ou recusar uma justificação de falta pendente. Usar o id de justificacoesPendentes.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        decisao: { type: "STRING", enum: ["aprovar", "recusar"] },
        fundamento: { type: "STRING", description: "Fundamento curto da decisão, em português." },
      },
      required: ["id", "decisao", "fundamento"],
    },
  },
  {
    name: "rever_marcacao",
    description: "Propor aceitar ou rejeitar uma marcação em revisão. Usar o id de marcacoesEmRevisao.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        decisao: { type: "STRING", enum: ["aceitar", "rejeitar"] },
        fundamento: { type: "STRING" },
      },
      required: ["id", "decisao", "fundamento"],
    },
  },
  {
    name: "definir_horario_qr",
    description: "Propor o horário em que o QR Code fixo aceita marcações. Sem das/as = qualquer hora.",
    parameters: { type: "OBJECT", properties: { das: { type: "STRING" }, as: { type: "STRING" } } },
  },
  {
    name: "abrir_relatorio",
    description: "Propor abrir o relatório do mês de um colaborador. Usar o id de pessoas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "cessar_colaborador",
    description: "Demitir / despedir / cessar o contrato de um colaborador: fica Cessado e perde o acesso ao Horbit. O histórico mantém-se. Usar o id de pessoas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" }, motivo: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "reactivar_colaborador",
    description: "Voltar a pôr um colaborador inactivo ou cessado como activo. Usar o id de pessoas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "editar_colaborador",
    description: "Alterar dados da ficha de um colaborador. Enviar só os campos a mudar. Departamento e filial têm de existir na empresa. Usar o id de pessoas.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        nome: { type: "STRING" },
        numero: { type: "STRING", description: "Nº mecanográfico" },
        funcao: { type: "STRING" },
        email: { type: "STRING" },
        telefone: { type: "STRING" },
        departamento: { type: "STRING" },
        filial: { type: "STRING" },
        nuit: { type: "STRING" },
        admissao: { type: "STRING", description: "Data AAAA-MM-DD" },
        estado: { type: "STRING", enum: ["activo", "inactivo"] },
      },
      required: ["id"],
    },
  },
  {
    name: "criar_colaborador",
    description: "Criar um colaborador novo. Se acesso=true, cria também o utilizador do Horbit (a palavra-passe é gerada ao confirmar).",
    parameters: {
      type: "OBJECT",
      properties: {
        nome: { type: "STRING" },
        numero: { type: "STRING", description: "Nº mecanográfico (opcional; gerado se faltar)" },
        funcao: { type: "STRING" },
        email: { type: "STRING" },
        telefone: { type: "STRING" },
        departamento: { type: "STRING" },
        filial: { type: "STRING" },
        admissao: { type: "STRING", description: "Data AAAA-MM-DD" },
        horario: { type: "STRING", description: "Nome de um dos horarios" },
        salario: { type: "NUMBER", description: "Salário base mensal em MZN" },
        acesso: { type: "BOOLEAN" },
        papel: { type: "STRING", enum: ["employee", "supervisor", "hr", "finance", "admin"] },
      },
      required: ["nome"],
    },
  },
  {
    name: "dar_acesso",
    description: "Dar acesso ao Horbit a um colaborador (cria utilizador e palavra-passe) ou mudar o papel de quem já tem acesso. Usar o id de pessoas.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        papel: { type: "STRING", enum: ["employee", "supervisor", "hr", "finance", "admin", "owner"] },
        utilizador: { type: "STRING", description: "Nome de utilizador (opcional)" },
      },
      required: ["id"],
    },
  },
  {
    name: "retirar_acesso",
    description: "Retirar o acesso ao Horbit a um colaborador (a ficha mantém-se). Usar o id de pessoas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "nova_palavra_passe",
    description: "Gerar uma palavra-passe nova para um colaborador que já tem acesso. Usar o id de pessoas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "alterar_salario",
    description: "Definir um novo salário base mensal (MZN) a partir de uma data. Usar o id de pessoas.",
    parameters: {
      type: "OBJECT",
      properties: { id: { type: "STRING" }, valor: { type: "NUMBER" }, desde: { type: "STRING", description: "Data AAAA-MM-DD (por omissão, hoje)" } },
      required: ["id", "valor"],
    },
  },
  {
    name: "atribuir_horario",
    description: "Atribuir um horário de trabalho a um colaborador a partir de uma data. horario = nome de um dos horarios.",
    parameters: {
      type: "OBJECT",
      properties: { id: { type: "STRING" }, horario: { type: "STRING" }, desde: { type: "STRING", description: "Data AAAA-MM-DD" } },
      required: ["id", "horario"],
    },
  },
  {
    name: "exportar_planilha",
    description: "Gerar e descarregar uma planilha Excel: lista de colaboradores ou assiduidade de um mês.",
    parameters: {
      type: "OBJECT",
      properties: { tipo: { type: "STRING", enum: ["colaboradores", "assiduidade"] }, mes: { type: "STRING", description: "AAAA-MM (assiduidade)" } },
      required: ["tipo"],
    },
  },
  {
    name: "avisar_responsavel",
    description: "Enviar um aviso ao responsável (dono) da empresa: notificação no Horbit e email, útil quando ele não está no Horbit.",
    parameters: { type: "OBJECT", properties: { assunto: { type: "STRING" }, mensagem: { type: "STRING" } }, required: ["assunto", "mensagem"] },
  },
  {
    name: "abrir_pagina",
    description: "Abrir uma página do Horbit.",
    parameters: {
      type: "OBJECT",
      properties: {
        pagina: {
          type: "STRING",
          enum: ["painel", "colaboradores", "assiduidade", "revisao", "justificacoes", "horarios", "relatorios", "salarios", "qr", "locais", "auditoria", "definicoes"],
        },
      },
      required: ["pagina"],
    },
  },
];

const ROLE_PT: Record<string, string> = { employee: "colaborador", supervisor: "supervisor", hr: "RH", finance: "financeiro", admin: "administrador", owner: "responsável" };
const PAGE_PT: Record<string, string> = {
  painel: "Painel", colaboradores: "Colaboradores", assiduidade: "Assiduidade", revisao: "Revisão de marcações", justificacoes: "Justificações",
  horarios: "Horários", relatorios: "Relatórios", salarios: "Salários", qr: "QR Code", locais: "Locais e estações", auditoria: "Auditoria", definicoes: "Definições",
};
const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
/** Encontra o nome exacto numa lista da empresa (departamentos, filiais, horários), sem distinguir maiúsculas. */
const pick = (list: unknown, v: unknown) => {
  const t = str(v).toLowerCase();
  return t ? ((list as string[] | undefined) ?? []).find((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t)) ?? null : null;
};
const person = (ctx: Ctx, id: unknown) =>
  (ctx?.pessoas ?? []).find((x: Ctx) => x.id === id) ?? (ctx?.equipaEsteMes ?? []).find((x: Ctx) => x.id === id) ?? null;

const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);
const isTime = (t: unknown) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);

/** Chama o Gemini com raciocínio mínimo (respostas mais rápidas). Se o modelo não aceitar essa opção, repete sem ela;
 *  se estiver sobrecarregado (503), tenta outra vez uma vez. */
async function gemini(key: string, model: string, payload: Record<string, unknown>): Promise<Response> {
  const cfg = (payload.generationConfig ?? {}) as Record<string, unknown>;
  const fast = { ...payload, generationConfig: { ...cfg, thinkingConfig: { thinkingLevel: "minimal" } } };
  const call = (p: Record<string, unknown>) =>
    fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(p),
    });
  let res = await call(fast);
  if (res.status === 400) res = await call(payload);
  if (res.status === 503) {
    await new Promise((r) => setTimeout(r, 700));
    res = await call(fast);
  }
  return res;
}

/** Corrida entre modelos: começa no primeiro; se falhar (sobrecarga) passa logo ao seguinte e, se demorar mais de
 *  HEDGE_MS, lança também o seguinte. Fica a primeira resposta que chegar; as outras são canceladas. */
function geminiRace(key: string, payload: Record<string, unknown>): Promise<Response | null> {
  const cfg = (payload.generationConfig ?? {}) as Record<string, unknown>;
  const fast = { ...payload, generationConfig: { ...cfg, thinkingConfig: { thinkingLevel: "minimal" } } };
  const ctrls: AbortController[] = [];
  return new Promise((resolve) => {
    let next = 0;
    let running = 0;
    let finished = false;
    let timer: number | undefined;
    const done = (res: Response | null, winner?: AbortController) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const c of ctrls) if (c !== winner) c.abort();
      resolve(res);
    };
    const launch = () => {
      if (finished) return;
      clearTimeout(timer);
      if (next >= MODELS.length) {
        if (!running) done(null);
        return;
      }
      const model = MODELS[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      running++;
      const call = (p: Record<string, unknown>) =>
        fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(p),
          signal: ctrl.signal,
        });
      (async () => {
        let res = await call(fast);
        if (res.status === 400) res = await call(payload);
        return res;
      })()
        .then((res) => {
          running--;
          if (res.ok && res.body) return done(res, ctrl);
          void res.body?.cancel();
          if (res.status === 429 || res.status === 503 || res.status === 404 || res.status === 500) launch();
          else if (!running) done(null);
        })
        .catch(() => {
          running--;
          if (!finished) launch();
        });
      timer = setTimeout(launch, HEDGE_MS);
    };
    launch();
  });
}

/** Reenvia o streaming do Gemini ao navegador: {d: texto} a cada pedaço e, no fim, {done, reply, actions}. */
function streamReply(res: Response, context: Ctx): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";
      const calls: { name: string; args?: Record<string, unknown> }[] = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const event = buf.slice(0, i);
            buf = buf.slice(i + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const j = JSON.parse(line.slice(6));
                for (const p of j?.candidates?.[0]?.content?.parts ?? []) {
                  if (p.text) {
                    text += p.text;
                    send({ d: p.text });
                  }
                  if (p.functionCall) calls.push(p.functionCall);
                }
              } catch {
                // pedaço incompleto: ignora
              }
            }
          }
        }
        const seen = new Set<string>();
        const actions = calls
          .map((c) => toAction(c.name, c.args ?? {}, context))
          .filter((a): a is Action => !!a && !seen.has(a.label) && !!seen.add(a.label))
          .slice(0, 20);
        const reply = text.trim() || (actions.length ? "Preparei o seguinte. Confirme para avançar:" : "");
        send(reply ? { done: true, reply, actions } : { error: "O assistente não devolveu resposta. Tente novamente." });
      } catch {
        send({ error: "A resposta foi interrompida. Tente novamente." });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(body, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

/** Valida a chamada do modelo contra o contexto e escreve o texto do botão. Devolve null se não fizer sentido. */
function toAction(name: string, args: Record<string, unknown>, ctx: Ctx): Action | null {
  if (name === "decidir_justificacao") {
    const j = (ctx?.justificacoesPendentes ?? []).find((x: Ctx) => x.id === args.id);
    if (!j || !["aprovar", "recusar"].includes(String(args.decisao))) return null;
    const fundamento = String(args.fundamento ?? "").trim() || "Decisão proposta pelo assistente.";
    return {
      type: name,
      label: `${args.decisao === "aprovar" ? "Aprovar" : "Recusar"} a justificação de ${j.nome} (${fmtDate(j.de)} a ${fmtDate(j.ate)}): ${fundamento}`,
      args: { id: j.id, decisao: args.decisao, fundamento },
    };
  }
  if (name === "rever_marcacao") {
    const m = (ctx?.marcacoesEmRevisao ?? []).find((x: Ctx) => x.id === args.id);
    if (!m || !["aceitar", "rejeitar"].includes(String(args.decisao))) return null;
    const fundamento = String(args.fundamento ?? "").trim() || "Decisão proposta pelo assistente.";
    return {
      type: name,
      label: `${args.decisao === "aceitar" ? "Aceitar" : "Rejeitar"} a marcação de ${m.nome} (${m.quando}): ${fundamento}`,
      args: { id: m.id, decisao: args.decisao, fundamento },
    };
  }
  if (name === "definir_horario_qr") {
    const sem = !args.das && !args.as;
    if (!sem && (!isTime(args.das) || !isTime(args.as))) return null;
    return {
      type: name,
      label: sem ? "O QR Code passa a aceitar marcações a qualquer hora" : `O QR Code passa a aceitar marcações das ${args.das} às ${args.as}`,
      args: sem ? {} : { das: args.das, as: args.as },
    };
  }
  if (name === "abrir_relatorio") {
    const e = person(ctx, args.id);
    if (!e) return null;
    return { type: name, label: `Abrir o relatório do mês de ${e.nome}`, args: { id: e.id } };
  }
  if (name === "abrir_pagina") {
    const p = str(args.pagina);
    return PAGE_PT[p] ? { type: name, label: `Abrir ${PAGE_PT[p]}`, args: { pagina: p } } : null;
  }
  if (name === "exportar_planilha") {
    const tipo = str(args.tipo);
    if (tipo === "colaboradores") return { type: name, label: "Descarregar a planilha Excel dos colaboradores", args: { tipo } };
    if (tipo !== "assiduidade") return null;
    const mes = /^\d{4}-\d{2}$/.test(str(args.mes)) ? str(args.mes) : String(ctx?.hoje ?? "").slice(0, 7);
    return { type: name, label: `Descarregar a planilha Excel da assiduidade de ${mes.slice(5, 7)}/${mes.slice(0, 4)}`, args: { tipo, mes } };
  }
  if (name === "avisar_responsavel") {
    const assunto = str(args.assunto).slice(0, 150), mensagem = str(args.mensagem).slice(0, 4000);
    if (!assunto || !mensagem) return null;
    return { type: name, label: `Avisar o responsável (notificação e email): ${assunto}`, args: { assunto, mensagem } };
  }
  if (name === "criar_colaborador") {
    const nome = str(args.nome);
    if (nome.length < 3) return null;
    const papel = ROLE_PT[str(args.papel)] ? str(args.papel) : "employee";
    const a: Record<string, unknown> = { nome, papel, acesso: args.acesso === true || args.acesso === "true" };
    for (const k of ["numero", "funcao", "email", "telefone"]) if (str(args[k])) a[k] = str(args[k]);
    const dep = pick(ctx?.departamentos, args.departamento), fil = pick(ctx?.filiais, args.filial), hor = pick(ctx?.horarios, args.horario);
    if (dep) a.departamento = dep;
    if (fil) a.filial = fil;
    if (hor) a.horario = hor;
    if (isDate(args.admissao)) a.admissao = args.admissao;
    const sal = Number(args.salario);
    if (Number.isFinite(sal) && sal > 0) a.salario = Math.round(sal * 100) / 100;
    const extra = [a.funcao, dep, a.salario ? `${Number(a.salario).toLocaleString("pt-PT")} MZN` : null].filter(Boolean).join(", ");
    return {
      type: name,
      label: `Criar o colaborador ${nome}${extra ? ` (${extra})` : ""}${a.acesso ? `, com acesso ao Horbit como ${ROLE_PT[papel]}` : ""}`,
      args: a,
    };
  }
  const p = person(ctx, args.id);
  if (!p) return null;
  const nome = p.nome;
  if (name === "cessar_colaborador") {
    if (p.estado === "cessado") return null;
    const motivo = str(args.motivo).slice(0, 300);
    return { type: name, label: `Cessar o contrato de ${nome} (fica Cessado e perde o acesso ao Horbit)${motivo ? `: ${motivo}` : ""}`, args: { id: p.id, motivo } };
  }
  if (name === "reactivar_colaborador") {
    if (p.estado === "activo") return null;
    return { type: name, label: `Reactivar ${nome}`, args: { id: p.id } };
  }
  if (name === "editar_colaborador") {
    const fields: [string, string, unknown][] = [
      ["nome", "nome", p.nome], ["numero", "nº", p.numero], ["funcao", "função", p.funcao], ["email", "email", p.email],
      ["telefone", "telefone", p.telefone], ["nuit", "NUIT", p.nuit],
    ];
    const a: Record<string, unknown> = { id: p.id };
    const changes: string[] = [];
    for (const [k, lab, cur] of fields) {
      const v = str(args[k]);
      if (v && v !== str(cur)) {
        a[k] = v;
        changes.push(`${lab} para ${v}`);
      }
    }
    const dep = pick(ctx?.departamentos, args.departamento);
    if (dep && dep !== p.departamento) (a.departamento = dep), changes.push(`departamento para ${dep}`);
    const fil = pick(ctx?.filiais, args.filial);
    if (fil && fil !== p.filial) (a.filial = fil), changes.push(`filial para ${fil}`);
    if (isDate(args.admissao) && args.admissao !== p.admissao) (a.admissao = args.admissao), changes.push(`admissão para ${fmtDate(String(args.admissao))}`);
    const est = str(args.estado);
    if ((est === "activo" || est === "inactivo") && est !== p.estado) (a.estado = est), changes.push(`estado para ${est}`);
    if (!changes.length) return null;
    return { type: name, label: `Alterar a ficha de ${nome}: ${changes.join("; ")}`, args: a };
  }
  if (name === "dar_acesso") {
    const papel = ROLE_PT[str(args.papel)] ? str(args.papel) : (p.papel ?? "employee");
    if (p.acesso === "sim") {
      if (papel === p.papel) return null;
      return { type: name, label: `Mudar o papel de ${nome} para ${ROLE_PT[papel]}`, args: { id: p.id, papel, utilizador: p.utilizador, mudarPapel: true } };
    }
    return {
      type: name,
      label: `Dar acesso ao Horbit a ${nome} como ${ROLE_PT[papel]} (a palavra-passe é gerada ao confirmar)`,
      args: { id: p.id, papel, utilizador: str(args.utilizador) || p.utilizador || "" },
    };
  }
  if (name === "retirar_acesso") {
    if (p.acesso !== "sim") return null;
    return { type: name, label: `Retirar o acesso ao Horbit a ${nome} (a ficha mantém-se)`, args: { id: p.id } };
  }
  if (name === "nova_palavra_passe") {
    if (p.acesso !== "sim") return null;
    return { type: name, label: `Gerar uma palavra-passe nova para ${nome}`, args: { id: p.id, utilizador: p.utilizador, papel: p.papel } };
  }
  if (name === "alterar_salario") {
    const valor = Math.round(Number(args.valor) * 100) / 100;
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const desde = isDate(args.desde) ? String(args.desde) : String(ctx?.hoje ?? "");
    return { type: name, label: `Alterar o salário base de ${nome} para ${valor.toLocaleString("pt-PT")} MZN a partir de ${fmtDate(desde)}`, args: { id: p.id, valor, desde } };
  }
  if (name === "atribuir_horario") {
    const hor = pick(ctx?.horarios, args.horario);
    if (!hor) return null;
    const desde = isDate(args.desde) ? String(args.desde) : String(ctx?.hoje ?? "");
    return { type: name, label: `Atribuir o horário ${hor} a ${nome} a partir de ${fmtDate(desde)}`, args: { id: p.id, horario: hor, desde } };
  }
  return null;
}

/** Segundo pedido (só na análise): obriga a propor uma decisão por cada pendente, como botões. */
async function proposeDecisions(key: string, model: string, payload: Record<string, unknown>, analysis: string, ctx: Ctx): Promise<Action[]> {
  const contents = [
    ...(payload.contents as unknown[]),
    { role: "model", parts: [{ text: analysis }] },
    { role: "user", parts: [{ text: "Agora propõe a decisão para cada justificação pendente e cada marcação em revisão, chamando as funções (uma chamada por pendente), com fundamento curto." }] },
  ];
  const res = await gemini(key, model, {
    ...payload,
    contents,
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["decidir_justificacao", "rever_marcacao"] } },
  });
  if (!res.ok) return [];
  const out = await res.json();
  const parts: { functionCall?: { name: string; args?: Record<string, unknown> } }[] = out?.candidates?.[0]?.content?.parts ?? [];
  const seen = new Set<string>();
  return parts
    .filter((p) => p.functionCall)
    .map((p) => toAction(p.functionCall!.name, p.functionCall!.args ?? {}, ctx))
    .filter((a): a is Action => !!a && !seen.has(String(a.args.id)) && !!seen.add(String(a.args.id)))
    .slice(0, 6);
}

/** Aviso ao responsável: notificação no Horbit (sempre) e email através do Resend (se RESEND_API_KEY estiver definido). */
async function notifyOwner(req: Request, body: { companyId?: string; subject?: string; message?: string }) {
  if (!body.companyId || !body.subject?.trim() || !body.message?.trim()) return json({ error: "Indique o assunto e a mensagem." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await supabase.rpc("ps_ai_notify_owner", { p_company: body.companyId, p_subject: body.subject, p_body: body.message });
  if (error) return json({ error: error.message }, 403);
  const emails: string[] = data?.emails ?? [];
  const resend = Deno.env.get("RESEND_API_KEY");
  let sent = 0;
  let emailError: string | null = null;
  if (resend && emails.length) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") ?? "Horbit <onboarding@resend.dev>",
        to: emails,
        subject: `[Horbit] ${body.subject.trim()}`,
        text: `${body.message.trim()}\n\n— Assistente do Horbit, ${data?.company ?? ""}`,
      }),
    });
    if (res.ok) sent = emails.length;
    else emailError = `O email não foi enviado (${res.status}).`;
  }
  return json({ notified: data?.notified ?? 0, emails, sent, emailConfigured: !!resend, emailError });
}

/** Voz neural: transforma o texto da resposta em áudio MP3 (Fish Audio S2.1 Pro, pelo OpenRouter). */
/** As duas vozes do Orbi (Fish Audio), sempre as mesmas: feminina e masculina. */
const VOICES: Record<string, string> = {
  f: Deno.env.get("OPENROUTER_TTS_VOICE_F") ?? "ca0326921a254a7295650b2cf85fe098",
  m: Deno.env.get("OPENROUTER_TTS_VOICE_M") ?? "69fc4effef064b4495d584e632e92fa6",
};

async function speakText(req: Request, body: { text?: string; voice?: string | boolean }) {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return json({ error: "Voz neural não configurada (segredo OPENROUTER_API_KEY)." }, 501);
  const text = String(body.text ?? "").trim().slice(0, 1500);
  if (!text) return json({ error: "Sem texto para ler." }, 400);
  // Só para quem tem sessão iniciada no Horbit (a chave do OpenRouter nunca sai do servidor).
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json({ error: "Sessão expirada. Entre novamente." }, 401);
  const voice = VOICES[body.voice === "m" ? "m" : "f"];
  const res = await fetch(`${OPENROUTER}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Horbit" },
    body: JSON.stringify({
      model: Deno.env.get("OPENROUTER_TTS_MODEL") ?? "fish-audio/s2.1-pro-free:free",
      input: text,
      voice,
      response_format: "mp3",
    }),
  });
  if (!res.ok || !res.body) return json({ error: `Voz neural indisponível (${res.status}).` }, 502);
  return new Response(res.body, {
    headers: { ...CORS, "Content-Type": res.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" },
  });
}

/** Memória: extrai factos duradouros da conversa e guarda-os (ps_ai_memory_add, script 04_parte10.sql). */
async function memorize(req: Request, body: { scope?: string; companyId?: string; messages?: Msg[]; explicit?: string }, key: string) {
  const company = body.scope === "platform" ? null : body.companyId ?? null;
  const convo = (body.messages ?? [])
    .filter((m) => m?.text?.trim())
    .slice(-14)
    .map((m) => `${m.role === "user" ? "Utilizador" : "Assistente"}: ${m.text.slice(0, 1200)}`)
    .join("\n");
  if (!convo) return json({ saved: 0 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const known = await supabase.rpc("ps_ai_memories", { p_company: company });
  if (known.error) return json({ error: known.error.message }, 403);
  const existing = ((known.data ?? []) as { content: string }[]).map((m) => `- ${m.content}`).join("\n") || "(vazia)";
  // Pedido explícito ("lembra-te que…"): se o modelo não extrair nada, guarda-se a própria frase.
  const fallback = async () => {
    const t = str(body.explicit)
      .replace(/^(por favor,?\s*)?(lembra-te|lembre-se|lembra|memoriza|não te esqueças|nao te esquecas|anota|guarda)( de| que| isto| isso)?[:,]?\s*/i, "")
      .slice(0, 300);
    if (t.length < 3) return json({ saved: 0 });
    const { data } = await supabase.rpc("ps_ai_memory_add", { p_company: company, p_items: [t.charAt(0).toUpperCase() + t.slice(1)] });
    return json({ saved: data ?? 0 });
  };
  const prompt = [
    "Lê a conversa entre um gestor e o assistente de RH do Horbit e extrai só factos duradouros que valha a pena lembrar em conversas futuras:",
    "preferências da pessoa (como quer as respostas, horários, tom), decisões e regras da empresa, nomes e funções importantes, pedidos explícitos para lembrar algo.",
    "Não guardes: dados do dia (presenças, atrasos de hoje), números que mudam, palavras-passe, dados bancários, NUIT, nem nada que já esteja na memória.",
    "Cada facto numa frase curta em português de Portugal, na terceira pessoa (ex.: \"Prefere respostas curtas.\"). Máximo 5. Se não houver nada, devolve lista vazia.",
    `Memória actual:\n${existing}`,
    `Conversa:\n${convo}`,
  ].join("\n\n");
  for (const model of MODELS) {
    const res = await gemini(key, model, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { factos: { type: "ARRAY", items: { type: "STRING" } } }, required: ["factos"] },
      },
    });
    if (!res.ok) {
      if (res.status === 429 || res.status === 503 || res.status === 404) continue;
      return body.explicit ? fallback() : json({ saved: 0 });
    }
    try {
      const out = await res.json();
      const text = (out?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      const factos = (JSON.parse(text)?.factos ?? []).map((x: unknown) => str(x)).filter((x: string) => x.length >= 3).slice(0, 5);
      if (!factos.length) return body.explicit ? fallback() : json({ saved: 0 });
      const { data, error } = await supabase.rpc("ps_ai_memory_add", { p_company: company, p_items: factos });
      return json({ saved: error ? 0 : data ?? 0 });
    } catch {
      return body.explicit ? fallback() : json({ saved: 0 });
    }
  }
  return body.explicit ? fallback() : json({ saved: 0 });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não suportado." }, 405);

  let body: {
    scope?: "company" | "platform";
    companyId?: string;
    messages?: Msg[];
    mode?: "chat" | "insights" | "notify" | "speak" | "memorize";
    explicit?: string;
    voice?: boolean | string;
    stream?: boolean;
    subject?: string;
    message?: string;
    text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido." }, 400);
  }
  if (body.mode === "notify") return notifyOwner(req, body);
  if (body.mode === "speak") return speakText(req, body);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta a chave do Gemini (segredo GEMINI_API_KEY) na Edge Function." }, 500);
  if (body.mode === "memorize") return memorize(req, body, key);
  const platform = body.scope === "platform";
  const insights = !platform && body.mode === "insights";
  let messages = (body.messages ?? []).filter((m) => m?.text?.trim()).slice(-16);
  if (insights) {
    messages = [
      {
        role: "user",
        text:
          "Faz agora a tua ronda de gestor de RH, sem eu pedir nada em concreto. Em 3 a 6 pontos curtos (lista com hífen), diz o que precisa de atenção hoje: " +
          "quem falta ou chegou atrasado, padrões de atrasos no mês, justificações e marcações por decidir, horas extra fora do normal, alterações recentes na auditoria que mereçam atenção. " +
          "Se nada precisar de atenção, diz isso numa frase. Depois propõe as acções que fazem sentido usando as funções disponíveis (por exemplo decidir justificações, rever marcações). Não inventes dados.",
      },
    ];
  }
  if (!messages.length || (!platform && !body.companyId)) return json({ error: "Escreva uma mensagem." }, 400);
  if (messages[messages.length - 1].role !== "user") return json({ error: "A última mensagem deve ser sua." }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  // Tudo o que o assistente precisa, pedido em paralelo (mais rápido).
  const company = platform ? null : body.companyId ?? null;
  const conversations = company
    ? supabase.from("ai_conversations").select("title,updated_at").eq("company_id", company)
    : supabase.from("ai_conversations").select("title,updated_at").is("company_id", null);
  const [ctx, extra, mem, past] = await Promise.all([
    platform ? supabase.rpc("ps_ai_platform_context") : supabase.rpc("ps_ai_context", { p_company: body.companyId }),
    // Equipa completa, acessos e organização (script 04_parte9.sql); sem ele, o assistente continua com o resto.
    platform ? Promise.resolve({ data: null, error: null }) : supabase.rpc("ps_ai_context_extra", { p_company: body.companyId }),
    // Memória (script 04_parte10.sql) e títulos das conversas anteriores desta pessoa.
    supabase.rpc("ps_ai_memories", { p_company: company }),
    conversations.order("updated_at", { ascending: false }).limit(12),
  ]);
  if (ctx.error) return json({ error: ctx.error.message }, 403);
  const context = ctx.data ?? {};
  if (!extra.error && extra.data) Object.assign(context, extra.data);
  // A marcação por link foi retirada: não falar dela.
  delete context.marcacoesPorLink;
  if (Array.isArray(context.qrCode)) for (const q of context.qrCode) delete q.linkReservaHoje;
  const memory = mem.error ? [] : ((mem.data ?? []) as { content: string }[]).map((m) => m.content);
  const history = past.error ? [] : ((past.data ?? []) as { title: string; updated_at: string }[]).map((c) => `${c.updated_at.slice(8, 10)}/${c.updated_at.slice(5, 7)}: ${c.title}`);

  const system = [
    "És o assistente do Horbit, um sistema de ponto, assiduidade e salários para empresas em Moçambique.",
    platform
      ? "Estás a conversar com o Super Admin da plataforma, que gere as empresas clientes."
      : "És o gestor de recursos humanos digital desta empresa, com acesso a toda a gestão: assiduidade, atrasos, faltas, justificações, marcações em revisão, fichas dos colaboradores, acessos ao Horbit, salários, horários, planilhas e auditoria. Fazes o trabalho: quando te pedem algo, preparas a acção. Estás a falar com alguém da gestão (responsável, RH, financeiro ou supervisor).",
    "Conversa de forma natural e simpática em português de Portugal: cumprimenta, responde a perguntas de seguimento, pede esclarecimento quando a pergunta é ambígua e lembra-te do que já foi dito nesta conversa.",
    "Sê directo e curto. Texto simples; listas com hífen quando ajudar; **negrito** só para números ou nomes importantes. Datas como 15/10 e horas como 07:30.",
    "Para perguntas sobre dados, usa apenas o contexto JSON abaixo e a memória. Se o dado não estiver lá ou estiver incompleto, diz que não o tens e indica a página do Horbit onde se vê. Nunca inventes horas, datas, nomes ou números.",
    platform
      ? "No contexto: marcacoesPorDia = últimos 14 dias."
      : "No contexto: hojeDetalhe = hoje (estado de cada pessoa); resumo e os números por departamento = últimos 30 dias; equipaEsteMes = mês corrente por pessoa; atrasos30dias = últimos 30 dias. Não confundas períodos: só digas \"hoje\" para dados de hojeDetalhe.",
    "Nunca mostres nomes técnicos do contexto (chaves do JSON, ids, nomes de funções, códigos de acções da auditoria como employees.insert); descreve-os em português corrente e fala pelos nomes das páginas e menus do Horbit.",
    "Para perguntas sobre como usar o Horbit, explica os passos com base no guia abaixo.",
    "O utilizador pode anexar ficheiros (imagens, PDF, planilhas Excel/CSV, texto): lê-os com atenção e responde sobre eles. Se pedir para registar o que está no ficheiro (por exemplo criar os colaboradores de uma planilha ou um atestado para uma justificação), usa as funções, uma chamada por pessoa ou acção.",
    platform
      ? "Não executas acções: não crias contas, não aprovas pedidos nem alteras empresas."
      : [
          "Tens funções para fazer tudo na gestão de pessoas: decidir justificações, rever marcações, cessar (demitir/despedir) ou reactivar colaboradores, editar fichas, criar colaboradores, dar, mudar ou retirar acessos, gerar palavras-passe, alterar salários, atribuir horários, exportar planilhas Excel, avisar o responsável por email e notificação, abrir páginas e horário do QR Code fixo.",
          "Sempre que o utilizador pede uma destas coisas, CHAMA a função na mesma resposta (uma chamada por acção) com os ids de pessoas; procura a pessoa pelo nome mesmo com erros de escrita e, se houver mais de uma parecida, pergunta qual. Cada chamada aparece como um botão Confirmar (ou é confirmada por voz). Não perguntes \"quer que avance?\": o botão já é a confirmação. Nunca digas que a acção já está feita; diz numa frase o que preparaste.",
          "Antes de cessar alguém, se não houver motivo, prepara a acção na mesma e menciona que pode indicar o motivo. As palavras-passe são geradas e mostradas só depois de confirmar; nunca inventes palavras-passe.",
          "As acções correm com as permissões de quem está a falar (minhasPermissoes); se faltar a permissão, explica que o papel dele não permite.",
          "Se o responsável não entra no Horbit há mais de um dia e há algo urgente, propõe avisar_responsavel.",
          "As respostas podem ser lidas em voz alta: frases curtas e naturais, sem tabelas. Valores em MZN; não calculas taxas legais.",
        ].join(" "),
    platform ? GUIDE_PLATFORM : GUIDE_COMPANY,
    body.voice === true
      ? "Estás numa chamada de voz: responde em 1 a 3 frases curtas e naturais, sem listas nem negrito; os detalhes ficam para o ecrã."
      : "",
    memory.length
      ? `O que já sabes desta pessoa (memória de conversas anteriores; usa com naturalidade quando for útil, sem a recitar):\n${memory.map((m) => `- ${m}`).join("\n")}`
      : "",
    history.length ? `Conversas anteriores desta pessoa contigo (data e assunto):\n${history.join("\n")}` : "",
    `Contexto de dados (${new Date().toISOString().slice(0, 10)}):`,
    JSON.stringify(context),
  ]
    .filter(Boolean)
    .join("\n\n");

  const payload: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m, i) => {
      const last = i === messages.length - 1;
      // A última mensagem pode trazer anexos (texto de planilhas já incluído no texto; imagens e PDF à parte).
      const parts: Record<string, unknown>[] = [{ text: m.text.slice(0, last ? 120_000 : 4000) }];
      if (last && m.role === "user") {
        for (const f of (m.files ?? []).slice(0, 5)) {
          if (f?.mime && FILE_TYPES.includes(f.mime) && typeof f.data === "string" && f.data.length <= MAX_FILE_B64) {
            parts.push({ text: `[Anexo: ${String(f.name ?? "ficheiro").slice(0, 120)}]` }, { inline_data: { mime_type: f.mime, data: f.data } });
          }
        }
      }
      return { role: m.role === "model" ? "model" : "user", parts };
    }),
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };
  if (!platform) {
    payload.tools = [{ functionDeclarations: TOOLS }];
    payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  // Conversa: a resposta vai chegando aos pedaços (o texto aparece e a voz começa logo).
  if (body.stream === true && !insights) {
    const res = await geminiRace(key, payload);
    if (res) return streamReply(res, context);
  }

  let lastError = "Assistente indisponível.";
  for (const model of MODELS) {
    const res = await gemini(key, model, payload);
    if (res.ok) {
      const out = await res.json();
      const parts: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] = out?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("").trim();
      const seen = new Set<string>();
      const actions = parts
        .filter((p) => p.functionCall)
        .map((p) => toAction(p.functionCall!.name, p.functionCall!.args ?? {}, context))
        .filter((a): a is Action => !!a && !seen.has(a.label) && !!seen.add(a.label))
        .slice(0, 20);
      // Na análise automática, se há pendentes e o modelo não propôs botões, pede só as propostas de decisão.
      if (insights && !actions.length && text && (context?.justificacoesPendentes?.length || context?.marcacoesEmRevisao?.length)) {
        actions.push(...(await proposeDecisions(key, model, payload, text, context)));
      }
      if (text || actions.length) {
        return json({ reply: text || "Preparei o seguinte. Confirme para avançar:", actions, model });
      }
      lastError = "O assistente não devolveu resposta.";
      continue;
    }
    lastError =
      res.status === 429 || res.status === 503
        ? "O assistente está sobrecarregado. Tente daqui a pouco."
        : res.status === 400 || res.status === 403
          ? `O Gemini recusou o pedido (${res.status}). Confirme a chave do Gemini.`
          : `Erro do Gemini (${res.status}).`;
    if (res.status !== 429 && res.status !== 503 && res.status !== 404) break;
  }
  return json({ error: lastError }, 502);
});
