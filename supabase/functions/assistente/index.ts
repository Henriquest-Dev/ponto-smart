// Horbit — Edge Function do assistente (Supabase; publicada como "Ponto-ai").
// Super Admin (scope "platform"): conversa sobre a plataforma.
// Empresa (scope "company"): gestor de RH — conversa, análise automática (mode "insights") e propostas de acções
// que o utilizador confirma no ecrã (a função nunca altera dados: só propõe). Mode "notify": avisa o responsável
// (notificação no Horbit e email). Mode "mail": credenciais e mensagens por email, pelo Gmail da empresa-mãe
// (Google Apps Script) ou pelo Resend. Mode "speak": voz neural (Fish Audio pelo OpenRouter,
// segredo OPENROUTER_API_KEY) — o Gemini é o cérebro, o Fish Audio é a voz. Mode "memorize": guarda na memória
// os factos duradouros de uma conversa (preferências, decisões), para o assistente se lembrar nas conversas seguintes.
// Os dados vêm de ps_ai_platform_context / ps_ai_context com o login do próprio utilizador (as regras de acesso aplicam-se).
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

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
- Papéis: responsável (owner), administrador, RH, financeiro, supervisor, gerente (manager), colaborador.
- Gerente: marca o ponto como colaborador e tem a gestão de estoque (materiais, entradas, saídas, contagens, resumo do mês). Funções avançadas ligam-se por gerente na ficha do colaborador (ex.: Oficina: viaturas pela matrícula, trabalhos feitos e relatórios em PDF). O proprietário e o administrador vêem Estoque e Oficina no menu Gestão.
- Locais e estações: local com morada e raio (geofence) e estações (ecrã da recepção).
- Assiduidade: lista diária; Revisão para decidir marcações duvidosas; Correcções para corrigir horas com motivo.
- Justificações: o colaborador pede com anexo; supervisor e/ou RH aprovam ou recusam com fundamento.
- Relatórios: relatório por colaborador (mês dia a dia) e exportação em Excel.
- Salários: fechar a assiduidade, gerar o pré-processamento, outra pessoa aprova, emitir recibos, registar pagamentos.
- Comunicados: escrever um email aos colaboradores (todos, um departamento ou pessoas escolhidas); sai em nome do Horbit, com os dados da empresa. Lá também se liga o resumo mensal do Orbi, que vai por email no início de cada mês.
- Auditoria: quem fez o quê e quando.`;

const GUIDE_PLATFORM = `Como funciona o Horbit (Super Admin):
- Visão geral: empresas, colaboradores activos, pedidos pendentes e actividade de marcações.
- Pedidos de acesso (menu Plataforma → Pedidos de acesso): as empresas pedem acesso na página pública "Pedir acesso" com só o nome, o email e o motivo. No menu Pedidos de acesso, o Super Admin usa "Pedir dados por email" para pedir o nome do responsável e os dados da empresa; com a resposta usa "Criar conta" (cria a empresa e o acesso do responsável) e depois "Enviar por email" para mandar as credenciais. Também pode recusar com motivo.
- Empresas: criar empresa directamente, ver o responsável, redefinir a palavra-passe do responsável, suspender ou reactivar.
- Auditoria: todas as acções na plataforma.
- Emails: o envio está integrado (sai em nome do Horbit pela conta Gmail da plataforma). Em Plataforma → Emails vê-se o estado e envia-se um teste.
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
        papel: { type: "STRING", enum: ["employee", "manager", "supervisor", "hr", "finance", "admin"] },
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
        papel: { type: "STRING", enum: ["employee", "manager", "supervisor", "hr", "finance", "admin", "owner"] },
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
    name: "enviar_email",
    description:
      "Enviar um email (em nome do Horbit, com os dados da empresa) a colaboradores: todos, um departamento ou pessoas escolhidas (ids de pessoas). Escreve tu o assunto e a mensagem completa, bem redigida.",
    parameters: {
      type: "OBJECT",
      properties: {
        para: { type: "STRING", enum: ["todos", "departamento", "pessoas"] },
        ids: { type: "ARRAY", items: { type: "STRING" }, description: "ids de pessoas (quando para = pessoas)" },
        departamento: { type: "STRING" },
        assunto: { type: "STRING" },
        mensagem: { type: "STRING", description: "Texto completo do email; parágrafos separados por linha em branco." },
      },
      required: ["para", "assunto", "mensagem"],
    },
  },
  {
    name: "enviar_resumo_mensal",
    description: "Enviar já, por email, o resumo do mês passado (o Orbi escreve-o) ao email da empresa e dos responsáveis.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "resumo_mensal_automatico",
    description: "Ligar ou desligar o envio automático do resumo do mês, por email, no início de cada mês.",
    parameters: { type: "OBJECT", properties: { ligado: { type: "BOOLEAN" } }, required: ["ligado"] },
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

/** Acções que o assistente do Super Admin pode propor (o Super Admin confirma no ecrã ou por voz). */
const PLATFORM_TOOLS = [
  {
    name: "enviar_email_plataforma",
    description: "Enviar um email em nome do Horbit para um ou mais endereços e/ou para o email de empresas (ids de empresas). Escreve tu o assunto e a mensagem completa.",
    parameters: {
      type: "OBJECT",
      properties: {
        emails: { type: "ARRAY", items: { type: "STRING" } },
        empresas: { type: "ARRAY", items: { type: "STRING" }, description: "ids de empresas (usa o email registado da empresa)" },
        assunto: { type: "STRING" },
        mensagem: { type: "STRING" },
      },
      required: ["assunto", "mensagem"],
    },
  },
  {
    name: "pedir_dados_pedido",
    description: "Responder a um pedido de acesso pedindo por email os dados que faltam (nome do responsável, telefone, NUIT, cidade). Usar o id de pedidosDeConta.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "criar_empresa",
    description:
      "Criar uma empresa cliente e o acesso do responsável. A palavra-passe é gerada ao confirmar e as credenciais seguem por email. Se vier de um pedido, passar o id do pedido.",
    parameters: {
      type: "OBJECT",
      properties: {
        nome: { type: "STRING" },
        responsavel: { type: "STRING", description: "Nome completo do responsável" },
        email: { type: "STRING" },
        telefone: { type: "STRING" },
        nuit: { type: "STRING" },
        utilizador: { type: "STRING", description: "Utilizador do responsável (opcional; gerado a partir do nome)" },
        pedido: { type: "STRING", description: "id do pedido de acesso (opcional)" },
      },
      required: ["nome", "responsavel", "email"],
    },
  },
  {
    name: "estado_empresa",
    description: "Suspender, reactivar ou cancelar uma empresa. Usar o id de empresas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" }, estado: { type: "STRING", enum: ["active", "suspended", "cancelled"] } }, required: ["id", "estado"] },
  },
  {
    name: "repor_palavra_passe_responsavel",
    description: "Gerar uma palavra-passe nova para o responsável de uma empresa e enviá-la por email. Usar o id de empresas.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  {
    name: "recusar_pedido",
    description: "Recusar um pedido de acesso com um motivo. Usar o id de pedidosDeConta.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" }, motivo: { type: "STRING" } }, required: ["id", "motivo"] },
  },
  {
    name: "abrir_pagina_plataforma",
    description: "Abrir uma página do painel do Super Admin.",
    parameters: {
      type: "OBJECT",
      properties: { pagina: { type: "STRING", enum: ["visao", "empresas", "pedidos", "emails", "auditoria"] } },
      required: ["pagina"],
    },
  },
];
const PLATFORM_PAGE_PT: Record<string, string> = { visao: "Visão geral", empresas: "Empresas", pedidos: "Pedidos de acesso", emails: "Emails", auditoria: "Auditoria" };
const STATUS_PT: Record<string, string> = { active: "Reactivar", suspended: "Suspender", cancelled: "Cancelar" };
const isEmail = (e: unknown) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

/** Acções do Super Admin: valida contra o contexto da plataforma e escreve o texto do botão. */
function toPlatformAction(name: string, args: Record<string, unknown>, ctx: Ctx): Action | null {
  const company = (id: unknown) => (ctx?.empresas ?? []).find((c: Ctx) => c.id === id) ?? null;
  const request = (id: unknown) => (ctx?.pedidosDeConta ?? []).find((r: Ctx) => r.id === id) ?? null;
  if (name === "enviar_email_plataforma") {
    const assunto = str(args.assunto).slice(0, 150), mensagem = str(args.mensagem).slice(0, 8000);
    const emails = new Set<string>(((args.emails as unknown[]) ?? []).filter(isEmail).map((e) => String(e).trim().toLowerCase()));
    for (const id of (args.empresas as unknown[]) ?? []) {
      const c = company(id);
      if (c && isEmail(c.email)) emails.add(String(c.email).toLowerCase());
    }
    if (!assunto || !mensagem || !emails.size) return null;
    const to = [...emails];
    return { type: name, label: `Enviar o email "${assunto}" para ${to.slice(0, 4).join(", ")}${to.length > 4 ? ` e mais ${to.length - 4}` : ""}`, args: { to, assunto, mensagem } };
  }
  if (name === "pedir_dados_pedido") {
    const r = request(args.id);
    if (!r || !isEmail(r.email)) return null;
    return { type: name, label: `Pedir por email à ${r.empresa} (${r.email}) os dados que faltam para criar a conta`, args: { id: r.id, email: r.email, empresa: r.empresa } };
  }
  if (name === "criar_empresa") {
    const nome = str(args.nome), responsavel = str(args.responsavel), email = str(args.email).toLowerCase();
    if (nome.length < 2 || responsavel.length < 3 || !isEmail(email)) return null;
    const r = args.pedido ? request(args.pedido) : null;
    return {
      type: name,
      label: `Criar a empresa ${nome} com o responsável ${responsavel} (credenciais por email para ${email})`,
      args: { nome, responsavel, email, telefone: str(args.telefone), nuit: str(args.nuit), utilizador: str(args.utilizador), pedido: r?.id ?? null },
    };
  }
  if (name === "estado_empresa") {
    const c = company(args.id), estado = str(args.estado);
    if (!c || !STATUS_PT[estado] || c.estado === estado) return null;
    return { type: name, label: `${STATUS_PT[estado]} a empresa ${c.nome}`, args: { id: c.id, estado, nome: c.nome } };
  }
  if (name === "repor_palavra_passe_responsavel") {
    const c = company(args.id);
    if (!c) return null;
    return { type: name, label: `Gerar uma palavra-passe nova para o responsável da ${c.nome}${isEmail(c.email) ? ` e enviá-la para ${c.email}` : ""}`, args: { id: c.id, nome: c.nome, email: isEmail(c.email) ? c.email : null } };
  }
  if (name === "recusar_pedido") {
    const r = request(args.id), motivo = str(args.motivo).slice(0, 500);
    if (!r || r.estado !== "pending" || !motivo) return null;
    return { type: name, label: `Recusar o pedido da ${r.empresa}: ${motivo}`, args: { id: r.id, motivo } };
  }
  if (name === "abrir_pagina_plataforma") {
    const p = str(args.pagina);
    return PLATFORM_PAGE_PT[p] ? { type: name, label: `Abrir ${PLATFORM_PAGE_PT[p]}`, args: { pagina: p } } : null;
  }
  return null;
}

const ROLE_PT: Record<string, string> = { employee: "colaborador", manager: "gerente", supervisor: "supervisor", hr: "RH", finance: "financeiro", admin: "administrador", owner: "responsável" };
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

/** O modelo disse que preparou uma acção mas não chamou a função? */
const CLAIMS_ACTION =
  /(preparei|pronto a (confirmar|criar|enviar)|vou (j[aá] )?(criar|enviar|mandar|avisar|suspender|reactivar|recusar|gerar|pedir|desligar|ligar)|basta confirmar|pode(s)? confirmar|confirme|fica pronto)/i;

/** Segunda tentativa, obrigando o modelo a chamar as funções do que acabou de dizer que preparou. */
async function forceActions(key: string, payload: Record<string, unknown>, said: string, ctx: Ctx): Promise<Action[]> {
  const contents = [
    ...(payload.contents as unknown[]),
    { role: "model", parts: [{ text: said }] },
    { role: "user", parts: [{ text: "Chama agora as funções do que acabaste de preparar (uma chamada por acção), com os dados desta conversa e os ids do contexto." }] },
  ];
  for (const model of MODELS) {
    try {
      const res = await gemini(key, model, { ...payload, contents, toolConfig: { functionCallingConfig: { mode: "ANY" } } });
      if (!res.ok) continue;
      const out = await res.json();
      const parts: { functionCall?: { name: string; args?: Record<string, unknown> } }[] = out?.candidates?.[0]?.content?.parts ?? [];
      const seen = new Set<string>();
      return parts
        .filter((p) => p.functionCall)
        .map((p) => toAction(p.functionCall!.name, p.functionCall!.args ?? {}, ctx))
        .filter((a): a is Action => !!a && !seen.has(a.label) && !!seen.add(a.label))
        .slice(0, 20);
    } catch {
      // tenta o modelo seguinte
    }
  }
  return [];
}

/** Reenvia o streaming do Gemini ao navegador: {d: texto} a cada pedaço e, no fim, {done, reply, actions}. */
function streamReply(res: Response, context: Ctx, recover?: (said: string) => Promise<Action[]>): Response {
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
        let actions = calls
          .map((c) => toAction(c.name, c.args ?? {}, context))
          .filter((a): a is Action => !!a && !seen.has(a.label) && !!seen.add(a.label))
          .slice(0, 20);
        if (!actions.length && recover && CLAIMS_ACTION.test(text)) actions = await recover(text);
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
  if (ctx?.papel === "Super Admin da plataforma") return toPlatformAction(name, args, ctx);
  if (name === "enviar_email") {
    const assunto = str(args.assunto).slice(0, 150), mensagem = str(args.mensagem).slice(0, 8000);
    if (!assunto || !mensagem) return null;
    const active = (ctx?.pessoas ?? []).filter((x: Ctx) => x.estado === "activo");
    const para = str(args.para);
    const ids = new Set(((args.ids as unknown[]) ?? []).map(String));
    const dep = str(args.departamento).toLowerCase();
    const chosen = para === "todos" ? active : para === "departamento" ? active.filter((x: Ctx) => String(x.departamento ?? "").toLowerCase() === dep) : (ctx?.pessoas ?? []).filter((x: Ctx) => ids.has(x.id));
    const withEmail = chosen.filter((x: Ctx) => isEmail(x.email));
    if (!withEmail.length) return null;
    const names = withEmail.map((x: Ctx) => x.nome as string);
    const missing = chosen.length - withEmail.length;
    return {
      type: name,
      label: `Enviar o email "${assunto}" a ${withEmail.length === 1 ? names[0] : `${withEmail.length} pessoas (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""})`}${missing ? ` — ${missing} sem email na ficha ficam de fora` : ""}`,
      args: { to: withEmail.map((x: Ctx) => String(x.email).toLowerCase()), assunto, mensagem },
    };
  }
  if (name === "enviar_resumo_mensal") return { type: name, label: "Enviar agora por email o resumo do mês passado", args: {} };
  if (name === "resumo_mensal_automatico") {
    const on = args.ligado === true || args.ligado === "true";
    return { type: name, label: on ? "Ligar o envio automático do resumo mensal por email" : "Desligar o envio automático do resumo mensal", args: { ligado: on } };
  }
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

/* ---------------------------------------------------------------------------------------------------------------
 * Emails: uma só conta envia tudo. Por ordem: SMTP (ex.: Gmail com palavra-passe de app, porta 465 — o Supabase
 * bloqueia as portas 25 e 587), Google Apps Script, Resend. Configura-se uma vez em Plataforma → Emails (ps_secrets).
 * ------------------------------------------------------------------------------------------------------------- */
type MailCfg = {
  url?: string | null;
  secret?: string | null;
  from?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
};
let mailCache: { at: number; cfg: MailCfg } | null = null;

/** Conta Gmail do Horbit, integrada (envia tudo, sem nada para configurar). Os segredos SMTP_USER e SMTP_PASS
 *  da Edge Function, se existirem, têm prioridade. Nunca escrever a palavra-passe no repositório. */
const HORBIT_SMTP_USER = "";
const HORBIT_SMTP_PASS = "";

async function mailConfig(): Promise<MailCfg> {
  if (mailCache && Date.now() - mailCache.at < 60_000) return mailCache.cfg;
  let cfg: MailCfg = {};
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, service, { auth: { persistSession: false } });
    const { data } = await admin.rpc("ps_mail_config");
    if (data) cfg = data as MailCfg;
  }
  const user = Deno.env.get("SMTP_USER") || HORBIT_SMTP_USER;
  const pass = Deno.env.get("SMTP_PASS") || HORBIT_SMTP_PASS;
  if (user && pass) {
    cfg.smtpUser = user;
    cfg.smtpPass = pass.replace(/\s+/g, "");
    cfg.smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    cfg.smtpPort = Number(Deno.env.get("SMTP_PORT") || 465);
  }
  cfg.smtpHost ||= "smtp.gmail.com";
  cfg.smtpPort ||= 465;
  cfg.url ||= Deno.env.get("MAIL_SCRIPT_URL");
  cfg.secret ||= Deno.env.get("MAIL_SCRIPT_SECRET");
  mailCache = { at: Date.now(), cfg };
  return cfg;
}

type MailOut = { to: string[]; subject: string; text: string; html: string; replyTo?: string };
type MailResult = { ok: boolean; via: "smtp" | "gmail" | "resend" | "none"; error?: string; quota?: number };

/** Mensagem de erro SMTP em português (as mais comuns com o Gmail). */
function smtpError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/535|Username and Password not accepted|BadCredentials|Invalid login/i.test(m))
    return "O Gmail recusou o email e a palavra-passe. Use uma palavra-passe de app (não a palavra-passe normal da conta).";
  if (/ETIMEDOUT|ECONNREFUSED|timeout|Connection closed/i.test(m)) return `Não foi possível ligar ao servidor SMTP (${m}). Use a porta 465.`;
  if (/550|5\.4\.5|Daily user sending limit/i.test(m)) return "Limite diário de envio do Gmail atingido. Tente amanhã.";
  return `O servidor SMTP não enviou o email: ${m}`;
}

async function smtpSend(cfg: MailCfg, m: MailOut, verifyOnly = false): Promise<MailResult> {
  const port = Number(cfg.smtpPort) || 465;
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost || "smtp.gmail.com",
    port,
    secure: port === 465 || port === 2465,
    auth: { user: cfg.smtpUser!, pass: cfg.smtpPass! },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    if (verifyOnly) await transport.verify();
    else
      await transport.sendMail({
        from: { name: cfg.from || "Horbit", address: cfg.smtpUser! },
        to: m.to.length === 1 ? m.to[0] : undefined,
        bcc: m.to.length > 1 ? m.to : undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
        replyTo: m.replyTo,
      });
    return { ok: true, via: "smtp" };
  } catch (e) {
    return { ok: false, via: "smtp", error: smtpError(e) };
  } finally {
    transport.close();
  }
}

async function callScript(cfg: MailCfg, payload: Record<string, unknown>) {
  const r = await fetch(cfg.url!, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret: cfg.secret, fromName: cfg.from || "Horbit", ...payload }),
    redirect: "follow",
  });
  const t = await r.text();
  try {
    return JSON.parse(t) as { ok?: boolean; error?: string; quota?: number };
  } catch {
    return {
      ok: false,
      error: /accounts\.google\.com|Sign in|Iniciar sess/i.test(t)
        ? "O Apps Script pede login: publique-o com acesso \"Qualquer pessoa\"."
        : `O Apps Script respondeu de forma inesperada (${r.status}).`,
    };
  }
}

async function deliver(m: MailOut): Promise<MailResult> {
  const cfg = await mailConfig();
  if (cfg.smtpUser && cfg.smtpPass) return smtpSend(cfg, m);
  if (cfg.url && cfg.secret) {
    try {
      const j = await callScript(cfg, { to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo });
      if (j.ok) return { ok: true, via: "gmail", quota: j.quota };
      return { ok: false, via: "gmail", error: j.error || "O Gmail não enviou o email." };
    } catch (e) {
      return { ok: false, via: "gmail", error: `Não foi possível contactar o Apps Script: ${e instanceof Error ? e.message : e}` };
    }
  }
  const resend = Deno.env.get("RESEND_API_KEY");
  if (resend) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "Horbit <onboarding@resend.dev>", to: m.to, subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
    });
    return res.ok ? { ok: true, via: "resend" } : { ok: false, via: "resend", error: `O Resend recusou o email (${res.status}).` };
  }
  return { ok: false, via: "none", error: "O envio automático de emails ainda não está configurado (Plataforma → Emails)." };
}

const esc = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Email com o aspecto do Horbit (HTML simples, compatível com o Gmail) e a versão em texto. */
type CompanyInfo = { name: string; email: string | null; phone: string | null; address: string | null; nuit: string | null };

function mailBody(o: {
  title: string;
  paragraphs: string[];
  rows?: [string, string][];
  button?: { label: string; url: string };
  after?: string[];
  footer?: string;
  company?: CompanyInfo | null;
}) {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#2a2540">${esc(t).replace(/\n/g, "<br>")}</p>`;
  const rows = o.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border:1px solid #e4e1ee;border-radius:12px;border-collapse:separate">
${o.rows.map(([k, v], i) => `<tr><td style="padding:12px 16px;${i ? "border-top:1px solid #eeecf4;" : ""}font-size:12.5px;color:#6b6780;width:96px">${esc(k)}</td><td style="padding:12px 16px;${i ? "border-top:1px solid #eeecf4;" : ""}font-family:Menlo,Consolas,monospace;font-size:14px;font-weight:bold;color:#1a1530;word-break:break-word">${esc(v)}</td></tr>`).join("\n")}
</table>`
    : "";
  const button = o.button
    ? `<p style="margin:4px 0 22px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#7041ec;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px">${esc(o.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f3f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
<tr><td style="background:#1a1530;padding:20px 28px;color:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:20px;font-weight:bold;letter-spacing:-0.3px;color:#ffffff">Horbit</td>
${o.company ? `<td align="right" style="font-size:13px;font-weight:bold;color:#cbbcff">${esc(o.company.name)}</td>` : ""}
</tr></table></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1a1530">${esc(o.title)}</h1>
${o.paragraphs.map(p).join("\n")}
${rows}${button}
${(o.after ?? []).map(p).join("\n")}
</td></tr>
${o.company ? `<tr><td style="padding:16px 28px;border-top:1px solid #eeecf4;font-size:12.5px;line-height:1.6;color:#4a4560"><b style="color:#1a1530">${esc(o.company.name)}</b>${companyLines(o.company).map((l) => `<br>${esc(l)}`).join("")}</td></tr>` : ""}
<tr><td style="padding:16px 28px;background:#faf9fc;border-top:1px solid #eeecf4;font-size:12px;line-height:1.5;color:#8a869a">${esc(o.footer ?? "Horbit · ponto, assiduidade e salários")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    o.title,
    "",
    ...o.paragraphs,
    "",
    ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`),
    o.button ? `\n${o.button.label}: ${o.button.url}` : "",
    "",
    ...(o.after ?? []),
    ...(o.company ? ["", "—", o.company.name, ...companyLines(o.company)] : []),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html, text };
}

function companyLines(c: CompanyInfo) {
  return [c.address, [c.phone ? `Tel. ${c.phone}` : null, c.email].filter(Boolean).join(" · "), c.nuit ? `NUIT ${c.nuit}` : null].filter(
    (x): x is string => !!x,
  );
}

// deno-lint-ignore no-explicit-any
async function companyInfo(supabase: any, companyId?: string | null): Promise<CompanyInfo | null> {
  if (!companyId) return null;
  const { data } = await supabase.from("companies").select("name,email,phone,address,nuit").eq("id", companyId).maybeSingle();
  return (data as CompanyInfo | null) ?? null;
}

type MailBody = {
  companyId?: string | null;
  kind?: "credentials" | "message" | "test" | "company";
  to?: string | string[];
  data?: { name?: string; company?: string; login?: string; password?: string; url?: string; role?: string; owner?: boolean; subject?: string; text?: string };
};

/** Link de entrada: só aceita o endereço do próprio Horbit (o site de onde veio o pedido). */
function loginLink(req: Request, url?: string) {
  const origin = req.headers.get("origin") ?? "";
  if (url && origin && url.startsWith(origin) && /^https?:\/\//.test(url)) return url;
  return origin ? `${origin}/login/` : "";
}

async function sendMailMode(req: Request, body: MailBody) {
  let to = ([] as string[]).concat(body.to ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  // Teste do Super Admin sem destinatário: vai para a própria conta que envia.
  if (body.kind === "test" && !to.length) {
    const admin = await supabase.rpc("ps_mail_settings");
    if (admin.error) return json({ error: admin.error.message }, 403);
    const cfg = await mailConfig();
    if (!cfg.smtpUser) return json({ error: "O envio de emails não está configurado.", notConfigured: true }, 501);
    to = [cfg.smtpUser.toLowerCase()];
  }
  if (!to.length) return json({ error: "Sem destinatário." }, 400);
  if (to.length > 500) return json({ error: "No máximo 500 destinatários de cada vez." }, 400);
  const batches: string[][] = [];
  for (let i = 0; i < to.length; i += 50) batches.push(to.slice(i, i + 50));
  for (const b of batches) {
    const auth = await supabase.rpc("ps_mail_authorize", { p_company: body.companyId ?? null, p_emails: b });
    if (auth.error) return json({ error: auth.error.message }, 403);
  }
  const d = body.data ?? {};
  const company = await companyInfo(supabase, body.companyId);
  const companyName = company?.name ?? d.company ?? "";
  let subject: string;
  let content: ReturnType<typeof mailBody>;
  let replyTo = company?.email ?? undefined;
  if (body.kind === "credentials") {
    if (!d.login || !d.password) return json({ error: "Faltam o utilizador ou a palavra-passe." }, 400);
    const first = String(d.name ?? "").trim().split(/\s+/)[0] || "";
    const url = loginLink(req, d.url);
    subject = d.owner ? `Horbit: a conta da ${companyName} está pronta` : `Horbit: o seu acesso${companyName ? ` à ${companyName}` : ""}`;
    content = mailBody({
      title: d.owner ? `A conta da ${companyName} está pronta` : `Olá${first ? `, ${first}` : ""}! O seu acesso ao Horbit está pronto`,
      paragraphs: d.owner
        ? [`Olá${first ? ` ${first}` : ""},`, `A conta da ${companyName} no Horbit está criada. Estas são as credenciais do responsável:`]
        : [`${companyName ? `A ${companyName}` : "A sua empresa"} criou o seu acesso ao Horbit, onde marca o ponto e vê o seu histórico, as justificações e os recibos.`],
      rows: [["Utilizador", String(d.login)], ["Palavra-passe", String(d.password)], ...(d.role ? ([["Perfil", String(d.role)]] as [string, string][]) : [])],
      button: url ? { label: "Entrar no Horbit", url } : undefined,
      after: d.owner
        ? ["No primeiro acesso, altere a palavra-passe em Conta > Segurança. Depois, em Colaboradores, crie os acessos da sua equipa: cada pessoa recebe o seu email automaticamente."]
        : ["Depois de entrar, mude a palavra-passe em Conta > Segurança. Este email é pessoal: não o reencaminhe."],
      company: company ?? (d.company ? { name: d.company, email: null, phone: null, address: null, nuit: null } : null),
      footer: "Enviado pelo Horbit. Se não esperava este email, ignore-o.",
    });
  } else if (body.kind === "test") {
    subject = "Horbit: email de teste";
    content = mailBody({ title: "O envio de emails está a funcionar", paragraphs: ["Este é um email de teste do Horbit. As credenciais, os comunicados das empresas e os avisos chegam assim às caixas de correio."] });
  } else {
    const subj = String(d.subject ?? "").trim().slice(0, 150);
    const text = String(d.text ?? "").trim().slice(0, 8000);
    if (!subj || !text) return json({ error: "Indique o assunto e a mensagem." }, 400);
    let after: string[] = [];
    if (body.kind === "company") {
      // Comunicado da empresa: diz quem escreveu e as respostas vão para essa pessoa (ou para o email da empresa).
      const { data: u } = await supabase.auth.getUser();
      const { data: me } = u?.user ? await supabase.from("users").select("name,email").eq("id", u.user.id).maybeSingle() : { data: null };
      const sender = (me as { name?: string; email?: string } | null) ?? null;
      if (sender?.name) after = [`Enviado por ${sender.name}${companyName ? `, ${companyName}` : ""}.`];
      if (sender?.email && /@.+\./.test(sender.email) && !sender.email.endsWith("@pontosmart.app")) replyTo = sender.email;
    }
    subject = companyName && body.kind === "company" ? `${companyName}: ${subj}` : subj;
    content = mailBody({ title: subj, paragraphs: text.split(/\n{2,}/), after, company, footer: "Enviado pelo Horbit." });
  }
  let sent = 0;
  for (const b of batches) {
    const r = await deliver({ to: b, subject, replyTo, ...content });
    if (!r.ok) {
      if (!sent) return json({ error: r.error, notConfigured: r.via === "none" }, r.via === "none" ? 501 : 502);
      return json({ sent, error: `Enviados ${sent}; os restantes falharam: ${r.error}` }, 207);
    }
    sent += b.length;
  }
  return json({ sent, to: body.kind === "test" ? to : undefined, via: "smtp" });
}

/* ---------------------------------------------------------------------------------------------------------------
 * Resumo mensal do Orbi: no início do mês, o primeiro acesso de alguém da empresa dispara o envio (uma vez por mês)
 * do resumo do mês anterior para o email da empresa e dos responsáveis. Também pode ser enviado à mão.
 * ------------------------------------------------------------------------------------------------------------- */
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const nf = (n: unknown, d = 0) => Number(n ?? 0).toLocaleString("pt-PT", { maximumFractionDigits: d, minimumFractionDigits: 0 });

function previousMonth(tz = "Africa/Maputo") {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date());
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// deno-lint-ignore no-explicit-any
async function orbiNarrative(key: string, sum: any): Promise<string[]> {
  const prompt = [
    `És o Orbi, o assistente de RH do Horbit. Escreve ao responsável da empresa ${sum.company?.name} o resumo de ${monthLabel(sum.month)}.`,
    "Português de Portugal, simpático e directo. 3 parágrafos curtos (máximo 110 palavras no total), sem listas, sem negrito, sem saudação nem despedida.",
    "1.º: como correu o mês (horas, presença). 2.º: o que precisa de atenção (atrasos, faltas, pendentes, estoque). 3.º: uma sugestão prática para o mês que começa.",
    "Usa só os números dos dados, sempre em algarismos (ex.: 598 horas, 5 dias), nunca por extenso; não inventes nada. Se um dado for zero, não o realces.",
    'Diz "horas extra" (não outros termos). Escreve só em português, com o alfabeto latino.',
    `Dados: ${JSON.stringify(sum)}`,
  ].join("\n");
  for (const model of MODELS) {
    try {
      const res = await gemini(key, model, { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 500 } });
      if (!res.ok) continue;
      const out = await res.json();
      const text = (out?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      // Só aceita texto em português limpo (os modelos leves às vezes metem palavras de outras línguas).
      if (text && !/[^\u0000-\u024F\u2010-\u2027\u20AC]/.test(text)) {
        return text.replace(/\*\*/g, "").split(/\n{2,}/).map((t: string) => t.trim()).filter(Boolean).slice(0, 4);
      }
    } catch {
      // tenta o modelo seguinte
    }
  }
  const a = sum.attendance ?? {};
  return [
    `Em ${monthLabel(sum.month)}, a equipa trabalhou ${nf(a.workedHours)} horas, com ${nf(a.overtimeHours, 1)} horas extra.`,
    `Houve ${nf(a.lateDays)} dias com atraso e ${nf(a.unjustified)} faltas injustificadas.`,
  ];
}

// deno-lint-ignore no-explicit-any
function reportEmail(sum: any, narrative: string[], link: string) {
  const c = sum.company ?? {};
  const cur = c.currency ?? "MZN";
  const a = sum.attendance ?? {};
  const money = (v: unknown) => `${nf(v, 2)} ${cur}`;
  const tile = (label: string, value: string, hint = "") =>
    `<td width="50%" style="padding:6px;vertical-align:top"><div style="border:1px solid #e4e1ee;border-radius:12px;padding:14px 16px;height:74px">
<div style="font-size:12px;color:#6b6780">${esc(label)}</div><div style="font-size:24px;font-weight:bold;color:#1a1530;margin-top:4px">${esc(value)}</div>
${hint ? `<div style="font-size:12px;color:#8a869a;margin-top:2px">${esc(hint)}</div>` : ""}</div></td>`;
  const section = (title: string, rows: [string, string][]) =>
    rows.length
      ? `<h2 style="margin:22px 0 8px;font-size:15px;color:#1a1530">${esc(title)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e1ee;border-radius:12px;border-collapse:separate">
${rows.map(([k, v], i) => `<tr><td style="padding:10px 14px;${i ? "border-top:1px solid #eeecf4;" : ""}font-size:13.5px;color:#2a2540">${esc(k)}</td><td align="right" style="padding:10px 14px;${i ? "border-top:1px solid #eeecf4;" : ""}font-size:13.5px;font-weight:bold;color:#1a1530">${esc(v)}</td></tr>`).join("")}
</table>`
      : "";
  const late: [string, string][] = (sum.topLate ?? []).map((t: { name: string; days: number; minutes: number }) => [t.name, `${t.days} ${t.days === 1 ? "dia" : "dias"} · ${t.minutes} min`]);
  const pending: [string, string][] = [
    ...(sum.pending?.justifications ? ([["Justificações por decidir", nf(sum.pending.justifications)]] as [string, string][]) : []),
    ...(sum.pending?.reviews ? ([["Marcações em revisão", nf(sum.pending.reviews)]] as [string, string][]) : []),
    ...(a.absentPending ? ([["Faltas ainda por justificar", nf(a.absentPending)]] as [string, string][]) : []),
  ];
  const pay: [string, string][] = sum.payroll?.totals
    ? [["Salários brutos", money(sum.payroll.totals.gross)], ["Salários líquidos", money(sum.payroll.totals.net)], ["Colaboradores processados", nf(sum.payroll.totals.employees)]]
    : [];
  const stock: [string, string][] = (sum.stockAlerts ?? []).map((s: { name: string; quantity: number; unit: string }) => [s.name, `${nf(s.quantity, 3)} ${s.unit}`]);
  const shop: [string, string][] = sum.workshop?.visits
    ? [["Entradas na oficina", nf(sum.workshop.visits)], ["Viaturas diferentes", nf(sum.workshop.vehicles)], ["Valor dos trabalhos", money(sum.workshop.amount)]]
    : [];
  const title = `Resumo de ${monthLabel(sum.month)}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f3f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
<tr><td style="background:#1a1530;padding:22px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:20px;font-weight:bold;color:#ffffff">Horbit</td><td align="right" style="font-size:13px;font-weight:bold;color:#cbbcff">${esc(c.name)}</td></tr></table>
<div style="margin-top:18px;font-size:24px;font-weight:bold;color:#ffffff">${esc(title)}</div>
<div style="margin-top:4px;font-size:13px;color:#b9b3cc">O resumo do mês preparado pelo Orbi, o assistente do Horbit.</div></td></tr>
<tr><td style="padding:20px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${tile("Colaboradores activos", nf(sum.team?.active), sum.team?.hired ? `${nf(sum.team.hired)} admitidos no mês` : "")}
${tile("Horas trabalhadas", `${nf(a.workedHours)} h`, a.overtimeHours ? `${nf(a.overtimeHours, 1)} h extra` : "")}
</tr><tr>
${tile("Dias com atraso", nf(a.lateDays), a.lateMinutes ? `${nf(a.lateMinutes)} minutos no total` : "")}
${tile("Faltas injustificadas", nf(a.unjustified), a.justified ? `${nf(a.justified)} justificadas` : "")}
</tr></table></td></tr>
<tr><td style="padding:10px 28px 6px">
<div style="background:#f3efff;border-radius:14px;padding:18px 20px">
<div style="font-size:12.5px;font-weight:bold;color:#7041ec;margin-bottom:8px">O Orbi diz</div>
${narrative.map((t) => `<p style="margin:0 0 10px;font-size:14.5px;line-height:1.6;color:#2a2540">${esc(t)}</p>`).join("")}
</div>
${section("Quem mais chegou atrasado", late)}
${section("Precisa de atenção", pending)}
${section("Salários do mês", pay)}
${section("Estoque a acabar", stock)}
${section("Oficina", shop)}
${link ? `<p style="margin:24px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:#7041ec;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px">Abrir o painel</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eeecf4;font-size:12.5px;line-height:1.6;color:#4a4560"><b style="color:#1a1530">${esc(c.name)}</b>${companyLines(c).map((l) => `<br>${esc(l)}`).join("")}</td></tr>
<tr><td style="padding:16px 28px;background:#faf9fc;border-top:1px solid #eeecf4;font-size:12px;line-height:1.5;color:#8a869a">Enviado pelo Horbit no início de cada mês. Pode desligar este resumo em Comunicados, no painel da empresa.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${title} — ${c.name}`,
    "",
    `Colaboradores activos: ${nf(sum.team?.active)} · Horas trabalhadas: ${nf(a.workedHours)} h · Dias com atraso: ${nf(a.lateDays)} · Faltas injustificadas: ${nf(a.unjustified)}`,
    "",
    "O Orbi diz:",
    ...narrative,
    ...[["Quem mais chegou atrasado", late], ["Precisa de atenção", pending], ["Salários do mês", pay], ["Estoque a acabar", stock], ["Oficina", shop]]
      .filter(([, r]) => (r as [string, string][]).length)
      .flatMap(([t, r]) => ["", String(t), ...(r as [string, string][]).map(([k, v]) => `- ${k}: ${v}`)]),
    link ? `\nAbrir o painel: ${link}` : "",
  ].join("\n");
  return { subject: `${c.name}: ${title}`, html, text };
}

async function monthlyReport(req: Request, body: { companyId?: string; force?: boolean }, key: string) {
  if (!body.companyId) return json({ error: "Empresa em falta." }, 400);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!service) return json({ error: "Falta a chave de serviço na Edge Function." }, 500);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, service, { auth: { persistSession: false } });
  let month: string;
  if (body.force) {
    const st = await user.rpc("ps_monthly_report_status", { p_company: body.companyId });
    if (st.error) return json({ error: st.error.message }, 403);
    month = previousMonth();
  } else {
    const due = await user.rpc("ps_monthly_report_due", { p_company: body.companyId });
    if (due.error) return json({ error: due.error.message }, 403);
    if (!due.data) return json({ skipped: true });
    month = String(due.data);
  }
  const s = await admin.rpc("ps_month_summary", { p_company: body.companyId, p_month: month });
  if (s.error || !s.data) return json({ error: s.error?.message ?? "Sem dados do mês." }, 500);
  const sum = s.data;
  const to: string[] = sum.recipients ?? [];
  if (!to.length) return json({ skipped: true, error: "A empresa não tem email registado (nem os responsáveis)." }, body.force ? 400 : 200);
  const claim = await admin.rpc("ps_monthly_report_claim", { p_company: body.companyId, p_month: month, p_recipients: to, p_force: !!body.force });
  if (claim.error) return json({ error: claim.error.message }, 500);
  if (!claim.data) return json({ skipped: true });
  const narrative = await orbiNarrative(key, sum);
  const origin = req.headers.get("origin") ?? "";
  const mail = reportEmail(sum, narrative, origin ? `${origin}/empresa/` : "");
  const r = await deliver({ to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: sum.company?.email ?? undefined });
  if (!r.ok) {
    await admin.rpc("ps_monthly_report_failed", { p_company: body.companyId, p_month: month });
    return json({ error: r.error }, 502);
  }
  return json({ sent: to.length, to, month });
}

/** Estado do envio (painel do Super Admin): testa a ligação ao Apps Script. */
async function mailStatus(req: Request) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const s = await supabase.rpc("ps_mail_settings");
  if (s.error) return json({ error: s.error.message }, 403);
  mailCache = null;
  const cfg = await mailConfig();
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return json({ configured: false, error: "Falta a chave de serviço na Edge Function." });
  if (cfg.smtpUser && cfg.smtpPass) {
    const r = await smtpSend(cfg, { to: [], subject: "", text: "", html: "" }, true);
    return json({ configured: true, via: "smtp", user: cfg.smtpUser, ok: r.ok, error: r.ok ? null : r.error });
  }
  if (!cfg.url || !cfg.secret) return json({ configured: false, resend: !!Deno.env.get("RESEND_API_KEY") });
  try {
    const j = await callScript(cfg, { ping: true });
    return json({ configured: true, via: "gmail", ok: !!j.ok, quota: j.quota ?? null, error: j.ok ? null : j.error });
  } catch (e) {
    return json({ configured: true, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Aviso ao responsável: notificação no Horbit (sempre) e email (Gmail/Resend, se configurado). */
async function notifyOwner(req: Request, body: { companyId?: string; subject?: string; message?: string }) {
  if (!body.companyId || !body.subject?.trim() || !body.message?.trim()) return json({ error: "Indique o assunto e a mensagem." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await supabase.rpc("ps_ai_notify_owner", { p_company: body.companyId, p_subject: body.subject, p_body: body.message });
  if (error) return json({ error: error.message }, 403);
  const emails: string[] = data?.emails ?? [];
  let sent = 0;
  let emailError: string | null = null;
  let configured = true;
  if (emails.length) {
    const company = await companyInfo(supabase, body.companyId);
    const content = mailBody({
      title: body.subject.trim(),
      paragraphs: body.message.trim().split(/\n{2,}/),
      company,
      footer: "Aviso do assistente do Horbit.",
    });
    const r = await deliver({ to: emails, subject: `[Horbit] ${body.subject.trim()}`, ...content });
    if (r.ok) sent = emails.length;
    else {
      configured = r.via !== "none";
      emailError = configured ? r.error ?? "O email não foi enviado." : null;
    }
  }
  return json({ notified: data?.notified ?? 0, emails, sent, emailConfigured: configured, emailError });
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
    mode?: "chat" | "insights" | "notify" | "speak" | "memorize" | "mail" | "mail_status" | "monthly_report";
    force?: boolean;
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
  if (body.mode === "mail") return sendMailMode(req, body as MailBody);
  if (body.mode === "mail_status") return mailStatus(req);
  if (body.mode === "speak") return speakText(req, body);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "Falta a chave do Gemini (segredo GEMINI_API_KEY) na Edge Function." }, 500);
  if (body.mode === "memorize") return memorize(req, body, key);
  if (body.mode === "monthly_report") return monthlyReport(req, body, key);
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
      ? [
          "És o gestor da plataforma: fazes o trabalho do Super Admin. Tens funções para enviar emails em nome do Horbit, pedir dados a quem pediu acesso, criar empresas (as credenciais seguem por email), recusar pedidos, suspender, reactivar ou cancelar empresas, gerar nova palavra-passe do responsável e abrir páginas.",
          "Sempre que o Super Admin pede uma destas coisas, CHAMA a função na mesma resposta (uma chamada por acção), com os ids do contexto. Cada chamada aparece como um botão Confirmar (ou confirma-se por voz). Não perguntes \"quer que avance?\"; diz numa frase o que preparaste. Nunca digas que já está feito.",
          "Para emails, escreve tu um assunto claro e a mensagem completa, educada e em português de Portugal, assinada como Equipa Horbit.",
        ].join(" ")
      : [
          "Tens funções para fazer tudo na gestão de pessoas: decidir justificações, rever marcações, cessar (demitir/despedir) ou reactivar colaboradores, editar fichas, criar colaboradores, dar, mudar ou retirar acessos, gerar palavras-passe, alterar salários, atribuir horários, exportar planilhas Excel, avisar o responsável por email e notificação, enviar emails aos colaboradores (em nome do Horbit, com os dados da empresa), enviar já o resumo do mês e ligar ou desligar o resumo mensal automático, abrir páginas e horário do QR Code fixo.",
          "Para emails, escreve tu um assunto claro e a mensagem completa e bem redigida em português de Portugal, assinada com o nome da empresa; não peças ao utilizador para escrever o texto.",
          "Sempre que o utilizador pede uma destas coisas, CHAMA a função na mesma resposta (uma chamada por acção) com os ids de pessoas; procura a pessoa pelo nome mesmo com erros de escrita e, se houver mais de uma parecida, pergunta qual. Cada chamada aparece como um botão Confirmar (ou é confirmada por voz). Não perguntes \"quer que avance?\": o botão já é a confirmação. Nunca digas que a acção já está feita; diz numa frase o que preparaste.",
          "Antes de cessar alguém, se não houver motivo, prepara a acção na mesma e menciona que pode indicar o motivo. As palavras-passe são geradas e mostradas só depois de confirmar; nunca inventes palavras-passe.",
          "As acções correm com as permissões de quem está a falar (minhasPermissoes); se faltar a permissão, explica que o papel dele não permite.",
          "Se o responsável não entra no Horbit há mais de um dia e há algo urgente, propõe avisar_responsavel.",
          "As respostas podem ser lidas em voz alta: frases curtas e naturais, sem tabelas. Valores em MZN; não calculas taxas legais.",
        ].join(" "),
    platform ? GUIDE_PLATFORM : GUIDE_COMPANY,
    body.voice === true
      ? "Estás numa chamada de voz: responde em 1 a 3 frases curtas e naturais, sem listas nem negrito; os detalhes ficam para o ecrã. Mesmo em voz, quando pedem para fazer algo (enviar email, criar, alterar, avisar), CHAMA a função na mesma resposta e diz que está pronto a confirmar: basta dizer \"sim\" ou \"envia\"."
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
  payload.tools = [{ functionDeclarations: platform ? PLATFORM_TOOLS : TOOLS }];
  payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };

  // Conversa: a resposta vai chegando aos pedaços (o texto aparece e a voz começa logo).
  if (body.stream === true && !insights) {
    const res = await geminiRace(key, payload);
    if (res) return streamReply(res, context, (said) => forceActions(key, payload, said, context));
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
      if (!insights && !actions.length && text && CLAIMS_ACTION.test(text)) actions.push(...(await forceActions(key, payload, text, context)));
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
