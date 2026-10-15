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
    <div className={cn("flex flex-col gap-3 px-4 pt-6 pb-2 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-10 lg:pt-9", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-[24px] leading-tight font-extrabold tracking-[-0.02em] lg:text-[30px]">{title}</h1>
        {description ? <p className="mt-1 text-[14px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-6 px-4 py-5 sm:px-6 lg:px-10 lg:py-7", className)} {...props} />;
}
