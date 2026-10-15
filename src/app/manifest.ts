import type { MetadataRoute } from "next";

export const dynamic = "force-static";
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Horbit",
    short_name: "Horbit",
    description: "Marcação de ponto, assiduidade e recibos.",
    start_url: `${base}/comecar/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#673fec",
    theme_color: "#673fec",
    lang: "pt-PT",
    categories: ["business", "productivity"],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${base}/icons/maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Marcar ponto", url: `${base}/app/marcar/`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: "192x192" }] }],
  };
}
