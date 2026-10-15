import type { Tone } from "@/components/ui/badge";

export const COMPANY_STATUS: Record<string, { label: string; tone: Tone }> = {
  trial: { label: "Experimental", tone: "info" },
  active: { label: "Activa", tone: "success" },
  suspended: { label: "Suspensa", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const SUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  trialing: { label: "Experimental", tone: "info" },
  active: { label: "Activa", tone: "success" },
  past_due: { label: "Em atraso", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  issued: { label: "Emitida", tone: "warning" },
  paid: { label: "Paga", tone: "success" },
  void: { label: "Anulada", tone: "neutral" },
};
