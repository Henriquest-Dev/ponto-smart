import { cn } from "@/lib/utils";

/**
 * Progresso por etapas: uma fila de hastes grossas arredondadas (como no logótipo).
 * Concluída = violeta, actual = tinta, por fazer = borda.
 */
export function StepStems({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("grid gap-2 sm:gap-3", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Etapas">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s} aria-current={state === "current" ? "step" : undefined} className="min-w-0">
            <span
              aria-hidden
              className={cn(
                "block h-3 rounded-full transition-colors duration-300",
                state === "done" ? "bg-primary" : state === "current" ? "bg-foreground" : "bg-border",
              )}
            />
            <span
              className={cn(
                "mt-2.5 flex items-baseline gap-1.5 truncate text-[12px] sm:text-[13px]",
                state === "todo" ? "font-medium text-subtle" : "font-bold text-foreground",
                state === "done" && "text-primary",
              )}
            >
              <span className="tabular font-extrabold">{i + 1}</span>
              <span className="truncate">{s}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
