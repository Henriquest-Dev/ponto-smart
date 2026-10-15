import { headers } from "next/headers";

/** IP e user-agent do pedido actual (Netlify envia o IP real em x-nf-client-connection-ip). */
export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}
