"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo com etiqueta por cima e caixa branca com contorno.
 * `trailing` permite um botão de texto à direita (ex.: Mostrar).
 */
export const FloatField = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { label: string; trailing?: React.ReactNode; invalid?: boolean; hint?: React.ReactNode }
>(function FloatField({ label, trailing, invalid, hint, className, id, ...props }, ref) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-[13.5px] font-bold text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={invalid || undefined}
          className={cn(
            "block h-12 w-full rounded-lg border border-border-strong bg-background px-3.5 text-[16px] font-medium text-foreground transition-[border-color,box-shadow]",
            "outline-none hover:border-[#bcb9c6] focus:border-primary focus:ring-4 focus:ring-primary/15",
            invalid && "border-danger focus:border-danger focus:ring-danger/15",
            trailing && "pr-24",
          )}
          {...props}
        />
        {trailing ? <div className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {hint ? <div className="mt-1.5 text-[12.5px]">{hint}</div> : null}
    </div>
  );
});
