const TOKEN_RE = /^ps1\.[\w-]{8,}$/;

/**
 * Extrai o token de um conteúdo lido: token simples ("ps1.<base64url>") ou URL de
 * marcação com o parâmetro `?t=`. Seguro para o cliente.
 */
export function extractQrToken(raw: string): string | null {
  const text = raw.trim();
  if (TOKEN_RE.test(text)) return text;
  try {
    const t = new URL(text).searchParams.get("t")?.trim();
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
