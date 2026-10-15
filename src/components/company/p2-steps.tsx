import { cn } from "@/lib/utils";

/**
 * Progresso por etapas: uma fila de hastes grossas arredondadas (como no logótipo).
 * Concluída = violeta, actual = tinta, por fazer = borda.
 */
export function StepStems({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol
      className={cn("grid gap-2 sm:gap-3", className)}
      style={{ gridTemplateColumns: steps.map((_, i) => (i === current ? "minmax(0, 3fr)" : "minmax(0, 1fr)")).join(" ") }}
      aria-label="Etapas"
    >
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s} aria-current={state === "current" ? "step" : undefined} className="min-w-0">
            <span
              aria-hidden
              className={cn(
                "block h-1 rounded-full transition-colors duration-300",
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
              <span className="tabular font-bold">{i + 1}</span>
              {/* No telemóvel só a etapa actual mostra o nome; as outras ficam pelo número. */}
              <span className={cn("truncate", state !== "current" && "hidden sm:inline")}>{s}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
