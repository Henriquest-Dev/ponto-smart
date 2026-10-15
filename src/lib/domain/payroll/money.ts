/**
 * Aritmética monetária em cêntimos inteiros (sem erros de vírgula flutuante).
 * Arredondamento: meio para cima, ao cêntimo.
 */
export type Cents = number;

export function toCents(value: string | number): Cents {
  const s = typeof value === "number" ? value.toFixed(6) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Valor monetário inválido: ${value}`);
  const negative = s.startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const padded = (frac + "000").slice(0, 3);
  let cents = Number(int) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

export function fromCents(c: Cents): string {
  const negative = c < 0;
  const abs = Math.abs(c);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Multiplica cêntimos por um factor decimal e arredonda ao cêntimo. */
export function mul(c: Cents, factor: number): Cents {
  const v = c * factor;
  return Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
}

export function pct(c: Cents, percent: number): Cents {
  return mul(c, percent / 100);
}
