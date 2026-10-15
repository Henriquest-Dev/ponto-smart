import { describe, expect, it } from "vitest";
import { decideGeofence } from "@/lib/domain/geofence";

describe("decideGeofence", () => {
  const max = 80;
  it("dentro do perímetro com boa precisão", () => {
    expect(decideGeofence({ distanceOutsideM: -10, accuracyM: 12, maxAccuracyM: max }).result).toBe("inside");
    expect(decideGeofence({ distanceOutsideM: 0, accuracyM: 12, maxAccuracyM: max }).result).toBe("inside");
  });
  it("fora do perímetro, sem margem de dúvida", () => {
    expect(decideGeofence({ distanceOutsideM: 500, accuracyM: 15, maxAccuracyM: max }).result).toBe("outside");
  });
  it("fora mas dentro do círculo de incerteza → inconclusivo (nunca prova de fraude)", () => {
    expect(decideGeofence({ distanceOutsideM: 20, accuracyM: 30, maxAccuracyM: max }).result).toBe("inconclusive");
  });
  it("precisão pior do que a política → inconclusivo, mesmo que o ponto esteja dentro", () => {
    expect(decideGeofence({ distanceOutsideM: -5, accuracyM: 150, maxAccuracyM: max }).result).toBe("inconclusive");
  });
  it("sem localização → indisponível", () => {
    expect(decideGeofence({ distanceOutsideM: null, accuracyM: null, maxAccuracyM: max }).result).toBe("unavailable");
  });
});
