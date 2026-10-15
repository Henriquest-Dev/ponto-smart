import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  absenceRequests, aiToolExecutions, attendanceDaily, departments, employees, payrollItems, payrollLines, payrollPeriods, payrollRuns,
} from "@/lib/db/schema";
import { can, type AppContext } from "@/lib/auth/context";
import { teamFilter } from "@/lib/queries/scope";
import { monthRange } from "@/lib/time";

type Ctx = AppContext & { company: NonNullable<AppContext["company"]> };

/**
 * Ferramentas controladas do assistente. Cada uma:
 *  - corre sempre no âmbito da empresa (e equipa) do utilizador autenticado;
 *  - respeita as permissões RBAC do utilizador;
 *  - nunca executa pagamentos, sanções ou aprovações — acções com efeito
 *    (notificações) ficam como rascunho até confirmação humana.
 */
export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "getAttendanceSummary",
    description: "Resumo de assiduidade de um mês (por colaborador): dias trabalhados, horas, atrasos, faltas e pendências.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "Mês no formato YYYY-MM" } }, required: ["month"], additionalProperties: false },
    strict: true,
  },
  {
    name: "findLateEmployees",
    description: "Lista colaboradores com atrasos (após tolerância) num intervalo de datas, ordenados por número de atrasos.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "getAbsenceRequests",
    description: "Pedidos de justificação de ausência, filtrados por estado.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "rejected", "all"] } }, required: ["status"], additionalProperties: false },
    strict: true,
  },
  {
    name: "preparePayrollReport",
    description: "Resumo do processamento salarial (execução mais recente) de um mês: estado, totais e avisos do motor. Só leitura.",
    input_schema: { type: "object", properties: { year: { type: "integer" }, month: { type: "integer" } }, required: ["year", "month"], additionalProperties: false },
    strict: true,
  },
  {
    name: "explainPayrollCalculation",
    description: "Linhas salariais de um colaborador num mês (rubrica, quantidade, taxa, valor, origem), para explicar o cálculo.",
    input_schema: {
      type: "object",
      properties: { employeeCode: { type: "string" }, year: { type: "integer" }, month: { type: "integer" } },
      required: ["employeeCode", "year", "month"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "createNotificationDraft",
    description: "Cria um RASCUNHO de notificação para colaboradores. Não é enviado: um responsável tem de confirmar no ecrã.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        employeeCodes: { type: "array", items: { type: "string" }, description: "Destinatários; vazio = todos os colaboradores activos no âmbito do utilizador" },
      },
      required: ["title", "body", "employeeCodes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "generateDocument",
    description: "Produz um documento de texto (ex.: relatório, comunicado, memorando) em Markdown para o utilizador descarregar e rever.",
    input_schema: { type: "object", properties: { title: { type: "string" }, markdown: { type: "string" } }, required: ["title", "markdown"], additionalProperties: false },
    strict: true,
  },
];

const ym = z.string().regex(/^\d{4}-\d{2}$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type ToolOutcome = { content: string; isError?: boolean; pendingApproval?: boolean; executionId?: string };

export async function runTool(ctx: Ctx, conversationId: string, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const scope = teamFilter(ctx);
  const companyId = ctx.company.id;
  const log = async (output: unknown, approvalStatus: "not_required" | "pending" = "not_required") => {
    const [row] = await db
      .insert(aiToolExecutions)
      .values({ companyId, conversationId, tool: name, input: (rawInput ?? {}) as Record<string, unknown>, output, approvalStatus })
      .returning({ id: aiToolExecutions.id });
    return row.id;
  };
  const deny = async (msg: string) => {
    await log({ error: msg });
    return { content: msg, isError: true };
  };

  try {
    switch (name) {
      case "getAttendanceSummary": {
        if (!can(ctx, "attendance.view")) return deny("Sem permissão para consultar assiduidade.");
        const { month } = z.object({ month: ym }).parse(rawInput);
        const [y, m] = month.split("-").map(Number);
        const { from, to } = monthRange(y, m);
        const rows = await db
          .select({
            code: employees.employeeCode,
            name: employees.fullName,
            worked: sql<number>`count(*) filter (where ${attendanceDaily.firstIn} is not null)`.mapWith(Number),
            hours: sql<number>`round(sum(${attendanceDaily.workedMinutes}) / 60.0, 1)`.mapWith(Number),
            late: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'late')`.mapWith(Number),
            unjustified: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'unjustified')`.mapWith(Number),
            justified: sql<number>`count(*) filter (where ${attendanceDaily.status} = 'justified')`.mapWith(Number),
            pending: sql<number>`count(*) filter (where ${attendanceDaily.status} in ('absent_pending','incomplete','review'))`.mapWith(Number),
          })
          .from(attendanceDaily)
          .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
          .where(and(eq(attendanceDaily.companyId, companyId), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to), scope))
          .groupBy(employees.employeeCode, employees.fullName)
          .orderBy(asc(employees.employeeCode));
        await log({ rows: rows.length });
        return { content: JSON.stringify({ month, employees: rows }) };
      }
      case "findLateEmployees": {
        if (!can(ctx, "attendance.view")) return deny("Sem permissão para consultar assiduidade.");
        const { from, to } = z.object({ from: ymd, to: ymd }).parse(rawInput);
        const rows = await db
          .select({
            code: employees.employeeCode,
            name: employees.fullName,
            department: departments.name,
            lateDays: sql<number>`count(*)`.mapWith(Number),
            lateMinutes: sql<number>`sum(${attendanceDaily.lateMinutes})`.mapWith(Number),
          })
          .from(attendanceDaily)
          .innerJoin(employees, eq(employees.id, attendanceDaily.employeeId))
          .leftJoin(departments, eq(departments.id, employees.departmentId))
          .where(and(eq(attendanceDaily.companyId, companyId), eq(attendanceDaily.status, "late"), gte(attendanceDaily.workDate, from), lte(attendanceDaily.workDate, to), scope))
          .groupBy(employees.employeeCode, employees.fullName, departments.name)
          .orderBy(desc(sql`count(*)`))
          .limit(50);
        await log({ rows: rows.length });
        return { content: JSON.stringify({ from, to, employees: rows, note: "Atrasos não geram multas automáticas." }) };
      }
      case "getAbsenceRequests": {
        if (!can(ctx, "absence.decide", "absence.decide.team")) return deny("Sem permissão para consultar justificações.");
        const { status } = z.object({ status: z.enum(["pending", "approved", "rejected", "all"]) }).parse(rawInput);
        const rows = await db
          .select({ name: employees.fullName, code: employees.employeeCode, start: absenceRequests.startDate, end: absenceRequests.endDate, type: absenceRequests.type, status: absenceRequests.status, reason: absenceRequests.reason })
          .from(absenceRequests)
          .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
          .where(and(eq(absenceRequests.companyId, companyId), status === "all" ? undefined : eq(absenceRequests.status, status), scope))
          .orderBy(desc(absenceRequests.createdAt))
          .limit(50);
        await log({ rows: rows.length });
        return { content: JSON.stringify({ requests: rows }) };
      }
      case "preparePayrollReport":
      case "explainPayrollCalculation": {
        if (!can(ctx, "payroll.view")) return deny("Sem permissão para consultar salários.");
        const input = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), employeeCode: z.string().optional() }).parse(rawInput);
        const [run] = await db
          .select({ r: payrollRuns, status: payrollPeriods.status })
          .from(payrollRuns)
          .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
          .where(and(eq(payrollRuns.companyId, companyId), eq(payrollPeriods.year, input.year), eq(payrollPeriods.month, input.month), sql`${payrollRuns.status} <> 'superseded'`))
          .orderBy(desc(payrollRuns.version))
          .limit(1);
        if (!run) {
          await log({ found: false });
          return { content: JSON.stringify({ found: false, message: "Sem processamento para esse mês." }) };
        }
        if (name === "preparePayrollReport") {
          await log({ runId: run.r.id });
          return { content: JSON.stringify({ version: run.r.version, runStatus: run.r.status, periodStatus: run.status, totals: run.r.totals, warnings: run.r.warnings, engine: run.r.engineVersion }) };
        }
        const [item] = await db
          .select({ i: payrollItems, name: employees.fullName })
          .from(payrollItems)
          .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
          .where(and(eq(payrollItems.runId, run.r.id), eq(employees.employeeCode, input.employeeCode ?? ""), scope))
          .limit(1);
        if (!item) return deny("Colaborador não encontrado nesse processamento.");
        const lines = await db.select().from(payrollLines).where(eq(payrollLines.payrollItemId, item.i.id)).orderBy(asc(payrollLines.sort));
        await log({ itemId: item.i.id });
        return {
          content: JSON.stringify({
            employee: item.name, version: run.r.version, runStatus: run.r.status, gross: item.i.gross, deductions: item.i.deductions, net: item.i.net,
            snapshot: item.i.snapshot,
            lines: lines.map((l) => ({ code: l.code, description: l.description, nature: l.nature, quantity: l.quantity, rate: l.rate, amount: l.amount, origin: l.origin })),
          }),
        };
      }
      case "createNotificationDraft": {
        if (!can(ctx, "employees.view")) return deny("Sem permissão.");
        const input = z.object({ title: z.string().min(3).max(120), body: z.string().min(3).max(1000), employeeCodes: z.array(z.string()).max(500) }).parse(rawInput);
        const recipients = await db
          .select({ code: employees.employeeCode, userId: employees.userId })
          .from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.status, "active"), scope, input.employeeCodes.length ? inArray(employees.employeeCode, input.employeeCodes) : undefined));
        const withAccount = recipients.filter((r) => r.userId);
        const executionId = await log({ ...input, recipients: withAccount.length }, "pending");
        return {
          content: JSON.stringify({ draft: true, recipients: withAccount.length, message: "Rascunho criado. O utilizador tem de confirmar o envio no ecrã; não foi enviado." }),
          pendingApproval: true,
          executionId,
        };
      }
      case "generateDocument": {
        const input = z.object({ title: z.string().min(3).max(150), markdown: z.string().min(10).max(40000) }).parse(rawInput);
        const executionId = await log(input);
        return { content: JSON.stringify({ ok: true, message: "Documento disponível para descarregar na conversa." }), executionId };
      }
      default:
        return { content: `Ferramenta desconhecida: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof z.ZodError) return deny(`Parâmetros inválidos: ${err.issues.map((i) => i.message).join("; ")}`);
    throw err;
  }
}
