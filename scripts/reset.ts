import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não está definida.");
if (process.env.NODE_ENV === "production" && !process.env.ALLOW_RESET) {
  throw new Error("Recusado: reset em produção exige ALLOW_RESET=1.");
}
const client = postgres(url, { max: 1, onnotice: () => {} });
await client.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
console.log("Base de dados limpa.");
await client.end();
