import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";

/**
 * Rate limiting de janela fixa guardado no PostgreSQL — funciona entre
 * várias instâncias serverless (memória local não é partilhada na Netlify).
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count
  `);
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new HttpError(429, "Demasiadas tentativas. Aguarde um momento e tente novamente.", "rate_limited");
  }
}
