import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Tokens de QR assinados (HMAC-SHA256 truncado a 128 bits), em formato binário
 * compacto (~85 caracteres) para que o QR seja pouco denso e fácil de ler por
 * câmaras de telemóvel à distância.
 *
 *   q1.<payload base64url>.<assinatura base64url>
 *   payload (43 bytes) = modo(1) | estação(16) | empresa(16) | expiração unix s(4) | nonce(6)
 *
 * O QR dinâmico expira em segundos e é registado em `qr_challenges`; o QR fixo
 * (expiração 0) não expira e tem menor garantia — usar só sob política aprovada.
 */
export type QrClaims = { sid: string; cid: string; mode: "dynamic" | "static" };

const PREFIX = "q1";
const SIG_BYTES = 16;
const sign = (data: string) => createHmac("sha256", `qr:${env.qrSecret()}`).update(data).digest().subarray(0, SIG_BYTES);
const uuidToBytes = (u: string) => Buffer.from(u.replace(/-/g, ""), "hex");
const bytesToUuid = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export async function signQrToken(claims: QrClaims, ttlSeconds?: number): Promise<string> {
  const buf = Buffer.alloc(43);
  buf.writeUInt8(claims.mode === "dynamic" ? 1 : 2, 0);
  uuidToBytes(claims.sid).copy(buf, 1);
  uuidToBytes(claims.cid).copy(buf, 17);
  buf.writeUInt32BE(claims.mode === "dynamic" ? Math.floor(Date.now() / 1000) + (ttlSeconds ?? 30) : 0, 33);
  randomBytes(6).copy(buf, 37);
  const body = `${PREFIX}.${buf.toString("base64url")}`;
  return `${body}.${sign(body).toString("base64url")}`;
}

export type QrVerification = { ok: true; claims: QrClaims } | { ok: false; reason: "expired" | "invalid" };

export async function verifyQrToken(token: string, graceSeconds = 10): Promise<QrVerification> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "invalid" };
  const expected = sign(`${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
  const buf = Buffer.from(parts[1], "base64url");
  if (buf.length !== 43) return { ok: false, reason: "invalid" };
  const mode = buf.readUInt8(0);
  if (mode !== 1 && mode !== 2) return { ok: false, reason: "invalid" };
  const exp = buf.readUInt32BE(33);
  if (mode === 1) {
    if (!exp) return { ok: false, reason: "invalid" };
    if (Date.now() / 1000 > exp + graceSeconds) return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    claims: { sid: bytesToUuid(buf.subarray(1, 17)), cid: bytesToUuid(buf.subarray(17, 33)), mode: mode === 1 ? "dynamic" : "static" },
  };
}

export { extractQrToken } from "./qr-client";
