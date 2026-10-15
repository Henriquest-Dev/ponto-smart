import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[14px] font-bold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:hidden select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border border-border-strong bg-background text-foreground hover:bg-surface-2",
        soft: "bg-surface-2 text-foreground hover:bg-[#e7e6ec]",
        ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
        danger: "bg-danger text-white hover:bg-[#ad2832]",
        "danger-outline": "border border-danger/40 text-danger hover:bg-danger-soft",
        link: "text-primary underline decoration-2 underline-offset-4 decoration-primary/30 hover:decoration-primary px-0 h-auto rounded-none",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-[15px]",
        icon: "h-10 px-3",
        "icon-sm": "h-8 px-2.5 text-[13px]",
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
