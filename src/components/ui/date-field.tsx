import { addDays, format } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { formatDate, parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useFieldId } from "./field-context";
import { Popover, PopoverContent, PopoverTrigger } from "./menus";

/**
 * Date picker showing `02 Oct 2026` (never ambiguous dd/mm vs mm/dd). Value is `YYYY-MM-DD` or "".
 */
export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  clearable = false,
  id,
  invalid,
  disabled,
  className,
  yearDropdown = false,
  quick,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** Month/year dropdowns (date of birth). */
  yearDropdown?: boolean;
  /** Quick buttons, e.g. Today / Tomorrow. */
  quick?: { label: string; value: string }[];
}) {
  const [open, setOpen] = useState(false);
  const fieldId = useFieldId(id);
  const selected = parseDate(value ?? null) ?? undefined;
  const minDate = parseDate(min ?? null) ?? undefined;
  const maxDate = parseDate(max ?? null) ?? undefined;
  const pick = (d: Date | undefined) => {
    if (!d) return;
    onChange(format(d, "yyyy-MM-dd"));
    setOpen(false);
  };
  const quickButtons = quick ?? [{ label: "Today", value: format(new Date(), "yyyy-MM-dd") }];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button
            id={fieldId}
            type="button"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-60 aria-invalid:border-destructive",
              !value && "text-muted-foreground/80",
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{value ? formatDate(value) : placeholder}</span>
          </button>
        </PopoverTrigger>
        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Clear date"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-2">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={pick}
          defaultMonth={selected ?? maxDate ?? new Date()}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
          weekStartsOn={1}
          showOutsideDays
          captionLayout={yearDropdown ? "dropdown" : "label"}
          startMonth={yearDropdown ? new Date(1940, 0) : undefined}
          endMonth={yearDropdown ? (maxDate ?? new Date()) : undefined}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <ChevronLeft className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              ),
          }}
          style={
            {
              "--rdp-accent-color": "var(--primary)",
              "--rdp-accent-background-color": "var(--accent)",
              "--rdp-day-height": "2.2rem",
              "--rdp-day-width": "2.2rem",
              "--rdp-day_button-height": "2.1rem",
              "--rdp-day_button-width": "2.1rem",
              fontSize: "0.85rem",
            } as React.CSSProperties
          }
        />
        <div className="flex flex-wrap gap-1.5 border-t px-1 pt-2">
          {quickButtons.map((q) => (
            <Button
              key={q.label}
              size="sm"
              variant="outline"
              onClick={() => pick(parseDate(q.value) ?? undefined)}
            >
              {q.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function quickDates(...offsets: number[]): { label: string; value: string }[] {
  return offsets.map((o) => ({
    label:
      o === 0 ? "Today" : o === 1 ? "Tomorrow" : o === -1 ? "Yesterday" : o > 0 ? `+${o} days` : `${o} days`,
    value: format(addDays(new Date(), o), "yyyy-MM-dd"),
  }));
}
