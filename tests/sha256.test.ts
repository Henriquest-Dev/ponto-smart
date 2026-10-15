import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/sha256";

describe("sha256Hex", () => {
  it("coincide com o node:crypto", () => {
    for (const s of ["", "abc", "ç ã é — MZN 25 000,00", "x".repeat(1000)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });
});
