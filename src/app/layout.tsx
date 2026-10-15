import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { SessionProvider } from "@/lib/sb/session";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "PontoSmart — ponto, assiduidade e salários", template: "%s · PontoSmart" },
  description: "Controlo de ponto por QR Code e localização, assiduidade, justificações e recibos de salário para empresas em Moçambique.",
  applicationName: "PontoSmart",
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "PontoSmart", statusBarStyle: "default" },
  icons: { icon: `${base}/icon.png`, apple: `${base}/icons/apple-touch-icon.png` },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>
        <SessionProvider>{children}</SessionProvider>
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        <ServiceWorker />
      </body>
    </html>
  );
}
