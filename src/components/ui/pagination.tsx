"use client";

import { cn } from "@/lib/utils";

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = "inline-flex h-9 cursor-pointer items-center rounded-lg border border-border-strong bg-background px-3 text-[13px] font-medium hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav className="flex items-center justify-between gap-2 pt-4" aria-label="Paginação">
      <button type="button" disabled={page <= 1} className={btn} onClick={() => onChange(page - 1)}>
        Anterior
      </button>
      <div className="flex items-center gap-1">
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-current={n === page ? "page" : undefined}
              className={cn("inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-[13px] font-medium tabular", n === page ? "bg-primary text-white" : "text-muted hover:bg-surface")}
            >
              {n}
            </button>
          ),
        )}
      </div>
      <button type="button" disabled={page >= pages} className={btn} onClick={() => onChange(page + 1)}>
        Seguinte
      </button>
    </nav>
  );
}
