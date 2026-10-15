import { afterEach, describe, expect, it, vi } from "vitest";
import { extractQrToken, signQrToken, verifyQrToken } from "@/lib/domain/qr";

const claims = { sid: "11111111-1111-1111-1111-111111111111", cid: "22222222-2222-2222-2222-222222222222" };

describe("tokens de QR", () => {
  afterEach(() => vi.useRealTimers());

  it("assina e valida um QR dinâmico", async () => {
    const t = await signQrToken({ ...claims, mode: "dynamic" }, 30);
    expect(t.length).toBeLessThan(100);
    expect(await verifyQrToken(t)).toEqual({ ok: true, claims: { ...claims, mode: "dynamic" } });
  });

  it("rejeita token adulterado", async () => {
    const t = await signQrToken({ ...claims, mode: "dynamic" }, 30);
    const [p, body, sig] = t.split(".");
    const bytes = Buffer.from(body, "base64url");
    bytes[20] ^= 0xff; // altera a empresa
    expect((await verifyQrToken(`${p}.${bytes.toString("base64url")}.${sig}`)).ok).toBe(false);
    expect((await verifyQrToken(`${t}x`)).ok).toBe(false);
  });

  it("expira após a validade + tolerância", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
    const t = await signQrToken({ ...claims, mode: "dynamic" }, 30);
    vi.setSystemTime(new Date("2026-10-15T08:00:35Z"));
    expect((await verifyQrToken(t, 10)).ok).toBe(true);
    vi.setSystemTime(new Date("2026-10-15T08:00:45Z"));
    expect(await verifyQrToken(t, 10)).toEqual({ ok: false, reason: "expired" });
  });

  it("QR fixo não expira", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = await signQrToken({ ...claims, mode: "static" });
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(await verifyQrToken(t)).toEqual({ ok: true, claims: { ...claims, mode: "static" } });
  });

  it("extrai o token de uma URL de marcação", async () => {
    const t = await signQrToken({ ...claims, mode: "dynamic" });
    expect(extractQrToken(`https://app.example/app/marcar?t=${encodeURIComponent(t)}`)).toBe(t);
    expect(extractQrToken(t)).toBe(t);
    expect(extractQrToken("https://outro-site.example/")).toBeNull();
  });
});
