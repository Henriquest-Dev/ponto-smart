"use client";

import "./globals.css";
import { ErrorScreen } from "./error";

/** Erro fora das páginas (no próprio layout). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-PT" translate="no">
      <body>
        <ErrorScreen error={error} onRetry={reset} />
      </body>
    </html>
  );
}
