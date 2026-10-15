/**
 * Leitura de segredos. Em produção falha de forma explícita se faltar algum,
 * mas apenas quando é usado (nunca durante o build).
 */
function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Variável de ambiente ${name} em falta ou demasiado curta (mín. 16 caracteres).`);
  }
  return devFallback;
}

export const env = {
  sessionSecret: () => required("SESSION_SECRET", "dev-only-session-secret-change-me"),
  qrSecret: () => required("QR_SIGNING_SECRET", "dev-only-qr-secret-change-me-please"),
  cronSecret: () => process.env.CRON_SECRET ?? "",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? "",
  isProduction: () => process.env.NODE_ENV === "production",
};
