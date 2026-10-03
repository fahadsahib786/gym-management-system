import { Search, X } from "lucide-react";
import type * as React from "react";
import { cloneElement, forwardRef, isValidElement, useId } from "react";
import { FieldIdContext } from "@/components/ui/field-context";
import { AffixInput, Input } from "@/components/ui/input";
import { Label } from "@/components/ui/primitives";
import { getCurrency, num } from "@/lib/format";
import { formatCnicInput, formatPhoneInput, parseAmount } from "@/lib/phone";
import { cn } from "@/lib/utils";

/** Label + control + hint/error, consistently spaced. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
  aside,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  // Link the label to its control automatically (clickable labels, screen readers, tests).
  const autoId = useId();
  let control = children;
  let id = htmlFor;
  if (!id && isValidElement<{ id?: string }>(children) && children.type !== "div") {
    id = children.props.id ?? autoId;
    control = cloneElement(children, { id });
  }
  const hintId = error || hint ? `${id ?? autoId}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={id}>
              {label}
              {required && <span className="text-destructive">*</span>}
            </Label>
          )}
          {aside}
        </div>
      )}
      {/* Controls wrapped in e.g. react-hook-form's Controller pick the id up from context. */}
      <FieldIdContext.Provider value={id}>{control}</FieldIdContext.Provider>
      {error ? (
        <p id={hintId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Whole-rupee amount with thousands separators. Value is a number. */
export function MoneyInput({
  value,
  onChange,
  invalid,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "prefix"> & {
  value: number;
  onChange: (v: number) => void;
  invalid?: boolean;
}) {
  return (
    <AffixInput
      prefix={getCurrency()}
      inputMode="numeric"
      autoComplete="off"
      aria-invalid={invalid || undefined}
      className={className}
      inputClassName="tabular font-medium"
      value={value ? num(value) : ""}
      placeholder="0"
      onChange={(e) => onChange(parseAmount(e.target.value))}
      onFocus={(e) => e.currentTarget.select()}
      {...props}
    />
  );
}

export const PhoneInput = forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "onChange" | "value"> & { value: string; onChange: (v: string) => void }
>(function PhoneInput({ value, onChange, ...props }, ref) {
  return (
    <Input
      ref={ref}
      inputMode="tel"
      autoComplete="off"
      placeholder="0300-1234567"
      value={value}
      onChange={(e) => onChange(formatPhoneInput(e.target.value))}
      {...props}
    />
  );
});

export function CnicInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      placeholder="31303-1234567-1"
      value={value}
      onChange={(e) => onChange(formatCnicInput(e.target.value))}
      {...props}
    />
  );
}

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
    value: string;
    onChange: (v: string) => void;
    wrapperClassName?: string;
  }
>(function SearchInput({ value, onChange, className, wrapperClassName, ...props }, ref) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("pr-8 pl-9", className)}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
});
