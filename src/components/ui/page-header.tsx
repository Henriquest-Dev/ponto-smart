import * as React from "react";
import { cn } from "@/lib/utils";

/** Cabeçalho de página: título à esquerda e acções à direita (como "Manage" no painel de referência). */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 lg:py-5", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-[20px] font-semibold tracking-tight lg:text-[22px]">{title}</h1>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-6", className)} {...props} />;
}
