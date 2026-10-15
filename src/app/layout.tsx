import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ServiceWorker } from "@/components/pwa/service-worker";

export const metadata: Metadata = {
  title: { default: "PontoSmart", template: "%s · PontoSmart" },
  description: "Controlo de ponto por QR Code, geofence, assiduidade e processamento salarial.",
  applicationName: "PontoSmart",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PontoSmart", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
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
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        <ServiceWorker />
      </body>
    </html>
  );
}
