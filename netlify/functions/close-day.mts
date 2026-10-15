// Função agendada da Netlify: todos os dias às 02:15 (UTC) — 04:15 em Maputo —
// consolida o dia anterior (faltas pendentes e registos incompletos).
import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("[close-day] URL ou CRON_SECRET em falta.");
    return new Response("missing config", { status: 500 });
  }
  const res = await fetch(`${base}/api/cron/close-day`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  console.log("[close-day]", res.status, await res.text());
  return new Response(null, { status: res.ok ? 200 : 500 });
};

export const config: Config = { schedule: "15 2 * * *" };
