import { Secret, TOTP } from "otpauth";

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: "PontoSmart",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totpFor(secretBase32, "verify").validate({ token: clean, window: 1 }) !== null;
}
