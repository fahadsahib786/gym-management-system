import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/ui/menus";
import { PRESETS, type PresetKey, presetRange } from "@/lib/dates";
import { todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface RangeValue {
  preset: PresetKey;
  from: string;
  to: string;
}

export function rangeFromPreset(preset: PresetKey): RangeValue {
  return { preset, ...presetRange(preset) };
}

/** Preset dropdown (Today, This month, …) with custom from/to dates. */
export function DateRangePicker({
  value,
  onChange,
  presets = PRESETS.map((p) => p.key),
  className,
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  presets?: PresetKey[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select
        className="w-40"
        aria-label="Period"
        value={value.preset}
        onValueChange={(v) => {
          const preset = v as PresetKey;
          onChange(preset === "custom" ? { ...value, preset } : rangeFromPreset(preset));
        }}
        options={PRESETS.filter((p) => presets.includes(p.key)).map((p) => ({
          value: p.key,
          label: p.label,
        }))}
      />
      {value.preset === "custom" && (
        <>
          <DateField
            className="w-40"
            value={value.from}
            onChange={(from) => onChange({ ...value, from })}
            max={value.to || todayISO()}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <DateField
            className="w-40"
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
            min={value.from}
            max={todayISO()}
          />
        </>
      )}
    </div>
  );
}
