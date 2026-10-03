import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Card, Label } from "@/components/ui/primitives";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/** KPI tile: label, value, optional change vs a named period and a hint. */
export function StatCard({
  label,
  value,
  icon,
  delta,
  deltaLabel,
  upIsGood = true,
  hint,
  tone = "default",
  onClick,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  delta?: { text: string; direction: "up" | "down" | "flat" } | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info" | "primary";
  onClick?: () => void;
  className?: string;
}) {
  const toneIcon: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-accent text-accent-foreground",
    success: "bg-success-soft text-success-ink",
    warning: "bg-warning-soft text-warning-ink",
    danger: "bg-danger-soft text-danger-ink",
    info: "bg-info-soft text-info-ink",
  };
  const good = delta && delta.direction !== "flat" && (delta.direction === "up") === upIsGood;
  const DeltaIcon =
    !delta || delta.direction === "flat" ? Minus : delta.direction === "up" ? ArrowUpRight : ArrowDownRight;
  const Comp = onClick ? "button" : "div";
  return (
    <Card className={cn("p-0", onClick && "transition-shadow hover:shadow-md", className)}>
      <Comp
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "flex h-full w-full flex-col gap-2 p-4 text-left",
          onClick && "rounded-xl focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-muted-foreground text-xs">{label}</span>
          {icon && (
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-lg [&_svg]:size-4",
                toneIcon[tone],
              )}
            >
              {icon}
            </span>
          )}
        </div>
        <div className="font-semibold text-2xl leading-none tracking-tight">{value}</div>
        {(delta || hint) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {delta && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-medium",
                  delta.direction === "flat"
                    ? "text-muted-foreground"
                    : good
                      ? "text-success-ink"
                      : "text-danger-ink",
                )}
              >
                <DeltaIcon className="size-3.5" />
                {delta.text}
              </span>
            )}
            {delta && deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
            {hint && <span className="text-muted-foreground">{hint}</span>}
          </div>
        )}
      </Comp>
    </Card>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t px-5 py-2.5 text-muted-foreground text-sm",
        className,
      )}
    >
      <span>{total === 0 ? "No results" : `${num(from)}–${num(to)} of ${num(total)}`}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center tabular">
          {page} / {pages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Confirmation for destructive or important actions, optionally asking for a reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Write a short reason…",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      /* the caller shows the error */
    } finally {
      setBusy(false);
    }
  };
  const blocked = requireReason && reason.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {requireReason && (
          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-reason">{reasonLabel}</Label>
              <Textarea
                id="confirm-reason"
                autoFocus
                rows={3}
                value={reason}
                placeholder={reasonPlaceholder}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            loading={busy}
            disabled={blocked}
            onClick={run}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
