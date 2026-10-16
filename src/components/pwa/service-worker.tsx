"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isOutdated } from "@/lib/app-version";
import { withBase } from "@/lib/sb/use-data";

/**
 * Regista o service worker e mantém a app actualizada: quando há uma publicação nova,
 * a próxima mudança de página recarrega o código (em vez de continuar com o antigo até fechar o separador).
 */
export function ServiceWorker() {
  const pathname = usePathname();
  const outdated = useRef(false);
  const first = useRef(true);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(withBase("/sw.js"), { scope: withBase("/") }).catch(() => {});
    const check = () => {
      void isOutdated().then((v) => {
        if (v) outdated.current = true;
      });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (outdated.current) window.location.reload();
  }, [pathname]);

  return null;
}
