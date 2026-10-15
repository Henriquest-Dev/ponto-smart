"use client";

import { DropdownMenu as M } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-52 rounded-[18px] border border-border bg-background p-1.5 shadow-[0_18px_40px_-20px_rgb(26_21_48/0.35)] data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-2 rounded-[12px] px-3 py-2 text-[13.5px] font-medium outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40 [&_svg]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-3 py-1.5 text-[12px] font-medium text-muted", className)} {...props} />;
}

export const DropdownSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
