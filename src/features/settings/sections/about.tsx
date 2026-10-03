import { useQuery } from "@tanstack/react-query";
import { Dumbbell, FolderOpen, KeyRound, Monitor, Moon, Sun, Type } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { InfoRow } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/menus";
import { Card, CardContent, CardHeader, CardTitle, Kbd } from "@/components/ui/primitives";
import { bytes } from "@/lib/format";
import { useCan } from "@/stores/session";
import { type TextSize, type Theme, useUi } from "@/stores/ui";

export function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const textSize = useUi((s) => s.textSize);
  const setTextSize = useUi((s) => s.setTextSize);
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  const changePin = async () => {
    setBusy(true);
    try {
      await api.auth.changePin(current, pin);
      toast.success("Your PIN was changed");
      setCurrent("");
      setPin("");
      setPin2("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Appearance (this computer)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Theme">
            <Segmented
              value={theme}
              onChange={(v) => setTheme(v as Theme)}
              options={[
                { value: "light", label: "Light", icon: <Sun /> },
                { value: "dark", label: "Dark", icon: <Moon /> },
                { value: "system", label: "Same as Windows", icon: <Monitor /> },
              ]}
            />
          </Field>
          <Field
            label="Text size"
            hint="Large text makes everything easier to read on small or far-away screens."
          >
            <Segmented
              value={textSize}
              onChange={(v) => setTextSize(v as TextSize)}
              options={[
                { value: "normal", label: "Normal", icon: <Type /> },
                { value: "large", label: "Large", icon: <Type className="size-5" /> },
              ]}
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Change my PIN</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-3 sm:grid-cols-3">
          <Field label="Current PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={current}
              onChange={(e) => setCurrent(clean(e.target.value))}
            />
          </Field>
          <Field label="New PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(clean(e.target.value))}
            />
          </Field>
          <Field label="Repeat new PIN" error={pin2 && pin2 !== pin ? "Does not match" : null}>
            <Input
              type="password"
              inputMode="numeric"
              value={pin2}
              onChange={(e) => setPin2(clean(e.target.value))}
            />
          </Field>
          <div className="sm:col-span-3">
            <Button
              onClick={changePin}
              loading={busy}
              disabled={current.length < 4 || pin.length < 4 || pin !== pin2}
            >
              <KeyRound /> Change PIN
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["F2", "New member"],
  ["F3", "Receive payment"],
  ["F4", "Check-in"],
  ["Ctrl K", "Search members"],
  ["Ctrl S", "Save the current form"],
  ["Esc", "Close a window"],
];

export function AboutSection() {
  const info = useQuery({ queryKey: ["app-info"], queryFn: api.app.info });
  const isAdmin = useCan("manageSettings");
  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 text-white">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Dumbbell className="size-7" />
          </div>
          <div>
            <div className="font-semibold text-xl">Danish Fitness — Gym Management</div>
            <div className="text-indigo-100 text-sm">
              Version {info.data?.version ?? "…"} · works fully offline
            </div>
          </div>
        </div>
        <CardContent className="pt-4">
          <p className="text-sm">
            Designed and developed by <span className="font-semibold">Fahad Baloch</span> for Danish Fitness,
            Model Town B, Khanpur (Rahim Yar Khan).
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label="Data file">{info.data?.dbPath}</InfoRow>
          <InfoRow label="Size">{info.data ? bytes(info.data.dbSizeBytes) : null}</InfoRow>
          <InfoRow label="Database version">{info.data?.schemaVersion}</InfoRow>
          <InfoRow label="Default backup folder">{info.data?.defaultBackupDir}</InfoRow>
          <div className="flex flex-wrap gap-2 pt-3">
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => void api.app.openFolder("data")}>
                <FolderOpen /> Open data folder
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void api.app.openFolder("logs")}>
              <FolderOpen /> Open log files
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Keyboard shortcuts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {SHORTCUTS.map(([k, label]) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
            >
              <span>{label}</span>
              <Kbd className="h-6 px-2 text-xs">{k}</Kbd>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
