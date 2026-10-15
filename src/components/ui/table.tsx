import * as React from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("w-full overflow-x-auto rounded-[22px] border border-border bg-background", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full min-w-[640px] border-collapse text-[13px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("text-left text-[12.5px] text-muted", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-12 px-4 font-bold whitespace-nowrap first:pl-6 last:pr-6", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-t border-border transition-colors hover:bg-surface", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("h-14 px-4 align-middle first:pl-6 last:pr-6", className)} {...props} />;
}
