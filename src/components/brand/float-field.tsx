"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Campo com etiqueta que sobe ao escrever e uma haste violeta que cresce no foco.
 * `trailing` permite um botão de texto à direita (ex.: Mostrar).
 */
export const FloatField = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { label: string; trailing?: React.ReactNode; invalid?: boolean; hint?: React.ReactNode }
>(function FloatField({ label, trailing, invalid, hint, className, id, onChange, defaultValue, ...props }, ref) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const [filled, setFilled] = React.useState(Boolean(defaultValue));
  return (
    <div className={className}>
      <div
        className={cn(
          "group relative rounded-[18px] bg-surface-2 transition-colors duration-200 focus-within:bg-background",
          "outline-2 outline-transparent focus-within:outline-primary",
          invalid && "outline-danger",
        )}
        style={{ outlineStyle: "solid", outlineOffset: -2 }}
      >
        <input
          ref={ref}
          id={fieldId}
          defaultValue={defaultValue}
          placeholder=" "
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setFilled(e.target.value.length > 0);
            onChange?.(e);
          }}
          className={cn(
            "peer block h-[60px] w-full rounded-[18px] bg-transparent px-5 pt-5 text-[16px] font-bold text-foreground outline-none",
            trailing && "pr-24",
          )}
          {...props}
        />
        <label
          htmlFor={fieldId}
          className={cn(
            "pointer-events-none absolute left-5 origin-left text-muted transition-all duration-200",
            "top-1/2 -translate-y-1/2 text-[15px] font-medium",
            "peer-focus:top-[17px] peer-focus:text-[12px] peer-focus:font-bold peer-focus:text-primary",
            filled && "top-[17px] text-[12px] font-bold",
          )}
        >
          {label}
        </label>
        {trailing ? <div className="absolute top-1/2 right-2 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {hint ? <div className="mt-1.5 px-1 text-[12.5px]">{hint}</div> : null}
    </div>
  );
});
