import bcrypt from "bcryptjs";

// bcryptjs é JavaScript puro: sem binários nativos, compatível com funções da Netlify.
const ROUNDS = 11;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function passwordPolicyError(plain: string): string | null {
  if (plain.length < 10) return "A palavra-passe deve ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "Use letras e números.";
  return null;
}
