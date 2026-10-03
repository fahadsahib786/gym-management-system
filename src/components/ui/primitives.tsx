/** Small presentational primitives: Label, Card, Badge, Separator, Skeleton, Kbd, Progress. */
import { cva, type VariantProps } from "class-variance-authority";
import { Label as LabelPrimitive, Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "flex select-none items-center gap-1.5 font-medium text-[0.82rem] text-foreground/90 leading-none",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-2", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-semibold text-[0.95rem] leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1 text-muted-foreground text-xs", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...props} />;
}

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        primary: "border-transparent bg-accent text-accent-foreground",
        success: "border-transparent bg-success-soft text-success-ink",
        warning: "border-transparent bg-warning-soft text-warning-ink",
        danger: "border-transparent bg-danger-soft text-danger-ink",
        info: "border-transparent bg-info-soft text-info-ink",
        upcoming: "border-transparent bg-upcoming-soft text-upcoming-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-medium font-sans text-[10px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Progress({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(v)}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-[width]", barClassName)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
