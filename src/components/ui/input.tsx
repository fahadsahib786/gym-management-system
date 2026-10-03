import type * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldId } from "./field-context";

export const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

export function Input({ className, type = "text", id, ...props }: React.ComponentProps<"input">) {
  return <input type={type} id={useFieldId(id)} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, id, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      id={useFieldId(id)}
      className={cn(inputClass, "h-auto min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

/** Input with a fixed prefix/suffix (e.g. "Rs", "kg"). */
export function AffixInput({
  prefix,
  suffix,
  className,
  inputClassName,
  id,
  ...props
}: React.ComponentProps<"input"> & {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  inputClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 w-full items-center rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25 has-[[aria-invalid=true]]:border-destructive",
        className,
      )}
    >
      {prefix && <span className="pl-3 text-muted-foreground text-sm">{prefix}</span>}
      <input
        id={useFieldId(id)}
        className={cn(
          "h-full w-full min-w-0 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/80",
          inputClassName,
        )}
        {...props}
      />
      {suffix && <span className="pr-3 text-muted-foreground text-sm">{suffix}</span>}
    </div>
  );
}
