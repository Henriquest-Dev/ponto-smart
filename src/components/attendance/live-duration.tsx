"use client";

import { useEffect, useState } from "react";

/** Contador de tempo decorrido desde `since` (actualiza a cada 30 s). */
export function LiveDuration({ since, baseMinutes = 0 }: { since: string | null; baseMinutes?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const extra = since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000)) : 0;
  const total = baseMinutes + extra;
  return (
    <span className="tabular" suppressHydrationWarning>
      {Math.floor(total / 60)}h{String(total % 60).padStart(2, "0")}
    </span>
  );
}
