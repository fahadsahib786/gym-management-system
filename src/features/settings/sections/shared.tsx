import { useQueryClient } from "@tanstack/react-query";
import { Plus, Save, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { SettingsUpdate } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";

/** Saves a settings section and refreshes app status (login / auto-lock settings live there too). */
export function useSaveSettings() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const save = async (update: SettingsUpdate, message = "Settings saved") => {
    setSaving(true);
    try {
      await api.settings.update(update);
      await qc.invalidateQueries({ queryKey: ["app-status"] });
      toast.success(message);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

export function SettingsCard({
  title,
  description,
  children,
  onSave,
  saving,
  dirty = true,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {(onSave || footer) && (
        <CardFooter className="justify-end">
          {footer}
          {onSave && (
            <Button onClick={onSave} loading={saving} disabled={!dirty}>
              <Save /> Save changes
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

/** Editable list of short strings (payment methods, timings, sources). */
export function ListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/60 py-1 pr-1 pl-3 text-sm"
          >
            {v}
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onChange(value.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus /> Add
        </Button>
      </div>
    </div>
  );
}
