import { withBase } from "@/lib/sb/use-data";

/** Versão do código que está a correr neste separador. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

/** Versão publicada no servidor (null se não for possível saber). */
export async function latestVersion(): Promise<string | null> {
  try {
    const r = await fetch(`${withBase("/version.json")}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: string };
    return j.version ?? null;
  } catch {
    return null;
  }
}

export async function isOutdated(): Promise<boolean> {
  if (APP_VERSION === "dev") return false;
  const v = await latestVersion();
  return !!v && v !== APP_VERSION;
}

/** Recarrega a aplicação com o código mais recente: limpa a cache do service worker e recarrega a página. */
export async function reloadFresh() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {}
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.update().catch(() => undefined)));
  } catch {}
  window.location.reload();
}
