"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";
import { errorMessage } from "./client";

export type DataState<T> = { data: T | undefined; error: string | null; loading: boolean; reload: () => void };

/** Carrega dados assíncronos (Supabase) com estado de carregamento/erro e recarga manual. */
export function useData<T>(fn: () => Promise<T>, deps: React.DependencyList): DataState<T> {
  const [data, setData] = React.useState<T | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Caminho com o prefixo do GitHub Pages (para window.location e ligações fora do next/link). */
export function withBase(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

/** Lê um parâmetro do URL (páginas estáticas usam ?id= em vez de rotas dinâmicas). Requer <Suspense> acima (os layouts das áreas já o têm). */
export function useQueryParam(name: string): string | null {
  return useSearchParams().get(name);
}
