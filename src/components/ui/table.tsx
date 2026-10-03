import type * as React from "react";
import { cn } from "@/lib/utils";

export function Table({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"table"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative w-full overflow-x-auto", wrapperClassName)}>
      <table className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("sticky top-0 z-[1] bg-muted/70 backdrop-blur", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TR({
  className,
  interactive,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b transition-colors",
        interactive &&
          "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 whitespace-nowrap px-3 text-left align-middle font-medium text-muted-foreground text-xs first:pl-5 last:pr-5",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}
