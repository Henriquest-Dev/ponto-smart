import { writeFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * Site estático (GitHub Pages). Todo o trabalho de servidor é feito pelo Supabase
 * (Auth, regras de acesso, funções SQL, Storage e Edge Function do assistente).
 * NEXT_PUBLIC_BASE_PATH = "/ponto-smart" quando publicado em <utilizador>.github.io/ponto-smart.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/** Versão desta publicação: a app compara-a com public/version.json para se actualizar sozinha. */
const appVersion = (process.env.COMMIT_REF || process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
try {
  writeFileSync("public/version.json", JSON.stringify({ version: appVersion }));
} catch {
  // sem escrita (ex.: pasta só de leitura): a verificação de versão fica inactiva
}

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
};

export default nextConfig;
