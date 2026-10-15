/** Extrai o token de um conteúdo lido (URL de marcação ou token JWT simples). Seguro para o cliente. */
export function extractQrToken(raw: string): string | null {
  const text = raw.trim();
  try {
    const url = new URL(text);
    return url.searchParams.get("t");
  } catch {
    return /^q1\.[\w-]+\.[\w-]+$/.test(text) ? text : null;
  }
}
