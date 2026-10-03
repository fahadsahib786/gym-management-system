import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, History, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BackupCheck } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { ConfirmDialog } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { BACKUP_KIND } from "@/lib/backups";
import { bytes, formatDateTime, num } from "@/lib/format";

/**
 * First-run option for a reinstalled or new PC: restore everything from a backup instead of setting up again.
 * Backups already on this PC (second drive, Documents) are listed; any other file can be chosen.
 */
export function RestoreFromBackup() {
  const found = useQuery({ queryKey: ["setup-backups"], queryFn: api.app.findBackups, retry: false });
  const [target, setTarget] = useState<{ path: string; check: BackupCheck } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const inspect = async (path: string) => {
    setChecking(path);
    try {
      setTarget({ path, check: await api.app.inspectSetupBackup(path) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(null);
    }
  };

  const pick = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "Danish Fitness backup", extensions: ["db"] }],
      title: "Choose a Danish Fitness backup",
    });
    if (typeof file === "string") await inspect(file);
  };

  const backups = found.data ?? [];
  return (
    <Card className="mt-8 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <History className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">Reinstalling, or moving to a new PC?</div>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Restore all members, fees and history from a backup instead of starting again.
          </p>
          {backups.length > 0 && (
            <ul className="mt-3 divide-y rounded-lg border">
              {backups.slice(0, 3).map((b) => (
                <li key={b.path} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{formatDateTime(b.createdAt)}</span>
                      <Badge variant={BACKUP_KIND[b.kind].badge}>{BACKUP_KIND[b.kind].label}</Badge>
                      <span className="text-muted-foreground text-xs">{bytes(b.sizeBytes)}</span>
                    </span>
                    <span className="block truncate text-muted-foreground text-xs" title={b.path}>
                      {b.path}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void inspect(b.path)}
                    loading={checking === b.path}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void pick()}>
            <FolderOpen /> Choose backup file…
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Restore this backup?"
        description={
          target && (
            <span className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-success-ink">
                <ShieldCheck className="size-4" /> {target.check.message}
              </span>
              <span>
                {target.check.gymName ? `Gym: ${target.check.gymName}. ` : ""}
                {num(target.check.members)} members, {num(target.check.payments)} payments.
                {target.check.lastActivity
                  ? ` Last activity: ${formatDateTime(target.check.lastActivity)}.`
                  : ""}
              </span>
              <span className="font-medium text-foreground">
                The gym will open with this data. Log in with the same PIN as before.
              </span>
            </span>
          )
        }
        confirmLabel="Restore now"
        onConfirm={async () => {
          if (!target) return;
          try {
            await api.app.restoreSetupBackup(target.path);
            toast.success("Data restored. Log in with your usual PIN.");
            setTimeout(() => window.location.reload(), 900);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Card>
  );
}
