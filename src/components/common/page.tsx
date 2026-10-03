import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import type * as React from "react";
import { errorMessage } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-xl tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1500px] px-5 py-5 lg:px-7", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-muted-foreground text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <CircleAlert className="size-5" />
      </div>
      <div>
        <p className="font-medium">Could not load this</p>
        <p className="mt-1 text-muted-foreground text-sm">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm", className)}
    >
      <LoaderCircle className="size-4 animate-spin" /> {label}
    </div>
  );
}

/** Label/value pair for detail panels. */
export function InfoRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2 text-sm", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children ?? "—"}</span>
    </div>
  );
}
