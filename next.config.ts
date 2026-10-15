import type { NextConfig } from "next";

/**
 * Site estático (GitHub Pages). Todo o trabalho de servidor é feito pelo Supabase
 * (Auth, regras de acesso, funções SQL, Storage e Edge Function do assistente).
 * NEXT_PUBLIC_BASE_PATH = "/ponto-smart" quando publicado em <utilizador>.github.io/ponto-smart.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
