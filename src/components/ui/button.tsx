import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[14px] font-bold tracking-[0.005em] transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:hidden select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border-2 border-border-strong bg-background text-foreground hover:border-foreground",
        soft: "bg-primary-soft text-primary hover:bg-[#e4dbfd]",
        ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
        danger: "bg-danger text-white hover:bg-[#ad2832]",
        "danger-outline": "border-2 border-danger/30 text-danger hover:bg-danger-soft",
        link: "text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary px-0 h-auto rounded-none",
      },
      size: {
        sm: "h-9 px-4 text-[13px]",
        md: "h-11 px-5",
        lg: "h-13 px-7 text-[15px]",
        icon: "h-11 px-4",
        "icon-sm": "h-9 px-3 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
