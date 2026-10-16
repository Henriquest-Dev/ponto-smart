import type { Tone } from "@/components/ui/badge";
import { DAILY_STATUS_LABEL, type DailyStatus } from "@/lib/domain/attendance-rules";

export { DAILY_STATUS_LABEL, EVENT_TYPE_LABEL } from "@/lib/domain/attendance-rules";

export const DAILY_STATUS_TONE: Record<DailyStatus, Tone> = {
  on_time: "success",
  present: "success",
  late: "warning",
  incomplete: "warning",
  absent_pending: "danger",
  unjustified: "danger",
  justified: "info",
  review: "primary",
  holiday: "neutral",
  day_off: "neutral",
};

export function dailyStatus(status: DailyStatus) {
  return { label: DAILY_STATUS_LABEL[status], tone: DAILY_STATUS_TONE[status] };
}

export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  accepted: { label: "Validada", tone: "success" },
  review: { label: "Em revisão", tone: "primary" },
  rejected: { label: "Rejeitada", tone: "danger" },
};

export const GEOFENCE_LABEL: Record<string, string> = {
  inside: "Dentro do perímetro",
  outside: "Fora do perímetro",
  inconclusive: "GPS inconclusivo",
  unavailable: "Sem localização",
};

export const ABSENCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Em análise", tone: "warning" },
  approved: { label: "Aprovada", tone: "success" },
  rejected: { label: "Recusada", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const STEP_DECISION: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendente", tone: "warning" },
  approved: { label: "Aprovado", tone: "success" },
  rejected: { label: "Recusado", tone: "danger" },
  skipped: { label: "Dispensado", tone: "neutral" },
};

export const PERIOD_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Aberto", tone: "neutral" },
  attendance_closed: { label: "Assiduidade fechada", tone: "info" },
  approved: { label: "Aprovado", tone: "success" },
  closed: { label: "Encerrado", tone: "neutral" },
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "warning" },
  approved: { label: "Aprovado", tone: "success" },
  superseded: { label: "Substituído", tone: "neutral" },
};

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  owner: "Proprietário",
  admin: "Administrador",
  hr: "Recursos Humanos",
  finance: "Financeiro",
  supervisor: "Supervisor",
  manager: "Gerente",
  employee: "Colaborador",
};

export const PAYMENT_METHODS: Record<string, string> = {
  transferencia: "Transferência bancária",
  mpesa: "M-Pesa",
  emola: "e-Mola",
  numerario: "Numerário",
  cheque: "Cheque",
};
