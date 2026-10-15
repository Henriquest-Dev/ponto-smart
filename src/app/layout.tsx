import "@fontsource/m-plus-rounded-1c/latin-400.css";
import "@fontsource/m-plus-rounded-1c/latin-500.css";
import "@fontsource/m-plus-rounded-1c/latin-700.css";
import "@fontsource/m-plus-rounded-1c/latin-800.css";
import "@fontsource/m-plus-rounded-1c/latin-ext-400.css";
import "@fontsource/m-plus-rounded-1c/latin-ext-700.css";
import "@fontsource/m-plus-rounded-1c/latin-ext-800.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { SessionProvider } from "@/lib/sb/session";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "Horbit — ponto, assiduidade e salários", template: "%s · Horbit" },
  description: "Controlo de ponto por QR Code e localização, assiduidade, justificações e recibos de salário para empresas em Moçambique.",
  applicationName: "Horbit",
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "Horbit", statusBarStyle: "default" },
  icons: { icon: `${base}/icons/icon.svg`, apple: `${base}/icons/apple-touch-icon.png` },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#eeecf5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // translate="no": a tradução automática do navegador altera o texto da página e faz o React falhar.
    <html lang="pt-PT" translate="no">
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className="notranslate">
        <SessionProvider>{children}</SessionProvider>
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        <ServiceWorker />
      </body>
    </html>
  );
}
