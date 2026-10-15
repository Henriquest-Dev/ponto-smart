/** Média móvel simples (janela à esquerda) para suavizar séries diárias. */
export function rollingAverage<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[], window = 7): T[] {
  return rows.map((row, i) => {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1);
    const out = { ...row };
    for (const k of keys) {
      const avg = slice.reduce((s, r) => s + Number(r[k] ?? 0), 0) / slice.length;
      (out as Record<string, unknown>)[k as string] = Math.round(avg * 10) / 10;
    }
    return out;
  });
}
