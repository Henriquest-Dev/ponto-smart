import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

declare global {
  var __pontoDb: { client: postgres.Sql; db: Database } | undefined;
}

/**
 * Ligação preguiçosa: só é criada no primeiro uso, nunca durante o import.
 * Assim o `next build` na Netlify não precisa de acesso à base de dados.
 */
function connect() {
  if (globalThis.__pontoDb) return globalThis.__pontoDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não está definida.");
  const client = postgres(url, {
    // Funções serverless: poucas ligações por instância; `prepare: false` é compatível
    // com poolers em modo transacção (Supabase/Neon pgbouncer).
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: /sslmode=require|neon\.tech|supabase\.(co|com)/.test(url) ? "require" : undefined,
  });
  const db = drizzle(client, { schema, casing: undefined });
  globalThis.__pontoDb = { client, db };
  return globalThis.__pontoDb;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(connect().db, prop, receiver);
  },
});

export function sqlClient() {
  return connect().client;
}

export { schema };
