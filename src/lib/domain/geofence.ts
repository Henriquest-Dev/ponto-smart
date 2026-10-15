/**
 * Decisão de geofence. Pura e testável — a distância é calculada em PostGIS.
 *
 * Princípio: o GPS de telemóvel pode ser impreciso (especialmente num recinto
 * pequeno, ex.: 30 × 15 m). Um sinal impreciso NUNCA é tratado como prova de
 * fraude: gera estado "inconclusivo", que permite nova leitura ou revisão.
 */
export type GeofenceResult = "inside" | "outside" | "inconclusive" | "unavailable";

export type GeofenceInput = {
  /** Distância (m) do ponto ao limite da zona; <= 0 significa dentro. `null` = sem localização. */
  distanceOutsideM: number | null;
  /** Raio de incerteza reportado pelo dispositivo (m). */
  accuracyM: number | null;
  /** Precisão máxima aceite pela política do local (m). */
  maxAccuracyM: number;
};

export type GeofenceDecision = { result: GeofenceResult; message: string };

export function decideGeofence({ distanceOutsideM, accuracyM, maxAccuracyM }: GeofenceInput): GeofenceDecision {
  if (distanceOutsideM === null || accuracyM === null || !Number.isFinite(accuracyM)) {
    return { result: "unavailable", message: "Localização indisponível. A marcação fica em revisão." };
  }
  if (accuracyM > maxAccuracyM) {
    return {
      result: "inconclusive",
      message: `Precisão GPS insuficiente (±${Math.round(accuracyM)} m). Tente novamente ao ar livre ou peça revisão.`,
    };
  }
  if (distanceOutsideM <= 0) {
    return { result: "inside", message: "Dentro do perímetro autorizado." };
  }
  // Fora do limite, mas o círculo de incerteza ainda toca a zona: não se pode concluir.
  if (distanceOutsideM <= accuracyM) {
    return {
      result: "inconclusive",
      message: "Muito perto do limite do local para concluir. Tente novamente ou peça revisão.",
    };
  }
  return {
    result: "outside",
    message: `Fora do perímetro autorizado (a cerca de ${Math.round(distanceOutsideM)} m).`,
  };
}
