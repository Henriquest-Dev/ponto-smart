import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Armazenamento privado de ficheiros (anexos de justificações, recibos).
 * Produção (Netlify): Netlify Blobs — nunca exposto publicamente; o acesso é
 * sempre feito por rotas autenticadas que verificam permissões.
 * Local: sistema de ficheiros em `.data/uploads`.
 */
const STORE_NAME = "pontosmart-private";

function driver(): "netlify" | "fs" {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit === "fs" || explicit === "netlify") return explicit;
  return process.env.NODE_ENV === "production" ? "netlify" : "fs";
}

async function blobStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function localPath(key: string) {
  const safe = key.replace(/[^a-zA-Z0-9/_.-]/g, "_").replace(/\.\.+/g, "_");
  return path.join(process.cwd(), ".data", "uploads", safe);
}

export async function putPrivateFile(key: string, data: ArrayBuffer, contentType: string) {
  if (driver() === "netlify") {
    const store = await blobStore();
    await store.set(key, data, { metadata: { contentType } });
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data));
}

export async function getPrivateFile(key: string): Promise<ArrayBuffer | null> {
  if (driver() === "netlify") {
    const store = await blobStore();
    return (await store.get(key, { type: "arrayBuffer" })) ?? null;
  }
  try {
    const buf = await readFile(localPath(key));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
// As funções da Netlify aceitam pedidos até ~6 MB: 4 MB por ficheiro e 5 MB no total.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 5 * 1024 * 1024;
