/** Select, DropdownMenu, Popover, Tooltip, Tabs, Switch, Checkbox — Radix-based, styled once. */
import { Check, ChevronDown } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  DropdownMenu as DropdownPrimitive,
  Popover as PopoverPrimitive,
  Select as SelectPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldId } from "./field-context";

const floating =
  "z-50 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1";

// ------------------------------------------------------------------------------------------ Select

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  className,
  disabled,
  id,
  invalid,
  ...rest
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  "aria-label"?: string;
}) {
  const fieldId = useFieldId(id);
  return (
    <SelectPrimitive.Root value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={fieldId}
        aria-invalid={invalid || undefined}
        aria-label={rest["aria-label"]}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-60 aria-invalid:border-destructive data-[placeholder]:text-muted-foreground/80",
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(floating, "max-h-80 min-w-[var(--radix-select-trigger-width)]")}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
              >
                <div className="min-w-0">
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  {o.hint && <div className="text-muted-foreground text-xs">{o.hint}</div>}
                </div>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                  <Check className="size-4 text-primary" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ------------------------------------------------------------------------------------- Dropdown

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(floating, "min-w-48 p-1", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive [&_svg]:text-destructive data-[highlighted]:bg-danger-soft",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Label>) {
  return (
    <DropdownPrimitive.Label
      className={cn("px-2.5 py-1.5 font-medium text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

// -------------------------------------------------------------------------------------- Popover

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(floating, "p-3 outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// -------------------------------------------------------------------------------------- Tooltip

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="data-[state=closed]:fade-out-0 z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-background text-xs shadow-md data-[state=closed]:animate-out"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ----------------------------------------------------------------------------------------- Tabs

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

// --------------------------------------------------------------------------- Switch & Checkbox

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-5 shrink-0 rounded border border-input bg-card shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// ------------------------------------------------------------------------------- Segmented

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <div
      role="radiogroup"
      className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4",
            size === "sm" ? "h-7 text-xs" : "h-8 text-sm",
            value === o.value && "bg-card text-foreground shadow-sm",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
