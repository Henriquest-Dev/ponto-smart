import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium hover:bg-surface";
  return (
    <nav className="flex items-center justify-between gap-2 pt-4" aria-label="Paginação">
      <Link aria-disabled={page <= 1} className={cn(btn, page <= 1 && "pointer-events-none opacity-40")} href={hrefFor(Math.max(1, page - 1))}>
        <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Anterior</span>
      </Link>
      <div className="flex items-center gap-1">
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted">…</span>
          ) : (
            <Link
              key={n}
              href={hrefFor(n)}
              className={cn("inline-flex size-9 items-center justify-center rounded-md text-[13px] tabular", n === page ? "bg-primary text-white" : "text-muted hover:bg-surface")}
            >
              {n}
            </Link>
          ),
        )}
      </div>
      <Link aria-disabled={page >= pages} className={cn(btn, page >= pages && "pointer-events-none opacity-40")} href={hrefFor(Math.min(pages, page + 1))}>
        <span className="hidden sm:inline">Seguinte</span> <ArrowRight className="size-4" />
      </Link>
    </nav>
  );
}
