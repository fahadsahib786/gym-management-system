import { useQuery } from "@tanstack/react-query";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  DatabaseBackup,
  Download,
  FlaskConical,
  FolderOpen,
  HardDrive,
  RotateCcw,
  ShieldCheck,
  Usb,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BackupCheck, BackupSettings, ExportKind, Settings } from "@/api/bindings";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { Field } from "@/components/common/fields";
import { LoadingBlock } from "@/components/common/page";
import { ConfirmDialog } from "@/components/common/widgets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, Switch } from "@/components/ui/menus";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BACKUP_KIND } from "@/lib/backups";
import { bytes, formatDateTime, num, timeAgo, todayISO } from "@/lib/format";
import { useCan, useSession } from "@/stores/session";
import { SettingsCard, useSaveSettings } from "./shared";

export function BackupSection({ settings }: { settings: Settings }) {
  const canRestore = useCan("restoreBackup");
  const canManage = useCan("manageSettings");
  const canExport = useCan("exportData");
  const status = useQuery({ queryKey: ["backup-status"], queryFn: api.backup.status });
  const [cfg, setCfg] = useState<BackupSettings>(settings.backup);
  const { save, saving } = useSaveSettings();
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ path: string; check: BackupCheck } | null>(null);

  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await api.backup.now();
      toast.success("Backup saved", { description: r.info.fileName });
      if (r.mirrorError) toast.warning(r.mirrorError);
      else if (r.mirroredTo) toast.info("Also copied to the second folder");
      await status.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async (key: "folder" | "mirrorFolder") => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: key === "folder" ? "Choose backup folder" : "Choose second backup folder (USB / Google Drive)",
    });
    if (typeof dir === "string") setCfg((c) => ({ ...c, [key]: dir }));
  };

  const inspect = async (path: string) => {
    try {
      const check = await api.backup.inspect(path);
      setRestoreTarget({ path, check });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const pickFile = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "Danish Fitness backup", extensions: ["db"] }],
      title: "Choose a backup file",
    });
    if (typeof file === "string") await inspect(file);
  };

  const exportKind = async (kind: ExportKind, label: string) => {
    const path = await saveDialog({
      defaultPath: `${label}-${todayISO()}.csv`,
      filters: [{ name: "CSV (Excel)", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const r = await api.exports.csv({ kind, path });
      toast.success(`Exported ${num(r.rows)} rows`, {
        action: { label: "Show file", onClick: () => void api.app.revealFile(r.path) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const s = status.data;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(settings.backup);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Backup status</CardTitle>
            <p className="mt-1 text-muted-foreground text-xs">
              Backups are full copies of all data. Keep a second copy on a USB drive.
            </p>
          </div>
          <Button onClick={backupNow} loading={busy}>
            <DatabaseBackup /> Back up now
          </Button>
        </CardHeader>
        <CardContent>
          {!s ? (
            <LoadingBlock />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/60 p-3">
                <div className="text-muted-foreground text-xs">Last backup</div>
                <div className="font-semibold">{s.lastBackupAt ? timeAgo(s.lastBackupAt) : "Never"}</div>
                {s.lastBackupAt && (
                  <div className="text-muted-foreground text-xs">{formatDateTime(s.lastBackupAt)}</div>
                )}
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <div className="text-muted-foreground text-xs">Automatic backups</div>
                <div className="font-semibold">
                  {s.autoBackup ? `On · every ${s.intervalHours} h` : "Off"}
                </div>
                <div className="text-muted-foreground text-xs">Also when the app starts and closes</div>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <div className="text-muted-foreground text-xs">Unsaved changes</div>
                <div className="font-semibold">
                  {s.unsavedChanges ? "Yes — will be backed up soon" : "None"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                <span className="truncate text-muted-foreground text-sm" title={s.folder}>
                  <HardDrive className="mr-1 inline size-4" />
                  {s.folder}
                </span>
                <Button size="sm" variant="outline" onClick={() => void api.app.openFolder("backups")}>
                  <FolderOpen /> Open folder
                </Button>
              </div>
              {!s.folderAvailable && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink sm:col-span-3">
                  The chosen backup folder ({cfg.folder}) cannot be reached — is that drive connected? Until
                  it is, backups are saved in the folder above.
                </p>
              )}
              {s.saferFolder && canManage && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-info-soft px-3 py-2 text-info-ink text-sm sm:col-span-3">
                  <span>
                    Backups are on the same drive as the data, so one disk problem or a Windows reinstall
                    could lose both. Keep them on drive {s.saferFolder.slice(0, 2)} instead.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={saving}
                    onClick={() => {
                      const next = { ...cfg, folder: s.saferFolder };
                      setCfg(next);
                      void save(
                        { section: "backup", value: next },
                        "Backups will now be kept on the other drive",
                      ).then(() => status.refetch());
                    }}
                  >
                    <HardDrive /> Use {s.saferFolder}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <SettingsCard
          title="Backup settings"
          onSave={() => save({ section: "backup", value: cfg }, "Backup settings saved")}
          saving={saving}
          dirty={dirty}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
              <span>
                <span className="font-medium">Automatic backups</span>
                <span className="block text-muted-foreground text-xs">
                  Strongly recommended — protects against power cuts, viruses and disk failure.
                </span>
              </span>
              <Switch checked={cfg.autoBackup} onCheckedChange={(v) => setCfg({ ...cfg, autoBackup: v })} />
            </label>
            <Field label="Backup every">
              <Select
                value={String(cfg.intervalHours)}
                onValueChange={(v) => setCfg({ ...cfg, intervalHours: Number(v) })}
                options={[2, 4, 6, 12, 24].map((h) => ({
                  value: String(h),
                  label: `${h} hours (when data changed)`,
                }))}
              />
            </Field>
            <Field
              label="Keep automatic backups"
              hint="Older automatic copies are deleted. Manual backups are never deleted."
            >
              <Select
                value={String(cfg.keepCount)}
                onValueChange={(v) => setCfg({ ...cfg, keepCount: Number(v) })}
                options={[10, 20, 30, 60, 90].map((n) => ({ value: String(n), label: `Last ${n}` }))}
              />
            </Field>
            <Field
              label="Backup folder"
              hint={
                cfg.folder
                  ? undefined
                  : `Default: ${s?.defaultFolder ?? "Documents\\Danish Fitness\\Backups"}`
              }
              className="sm:col-span-2"
            >
              <div className="flex gap-2">
                <Input readOnly value={cfg.folder ?? ""} placeholder="Default folder" />
                <Button variant="outline" onClick={() => chooseFolder("folder")}>
                  <FolderOpen /> Choose
                </Button>
                {cfg.folder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCfg({ ...cfg, folder: null })}
                    aria-label="Use default folder"
                  >
                    <X />
                  </Button>
                )}
              </div>
            </Field>
            <Field
              label="Second copy (USB drive or Google Drive folder)"
              hint="Each backup is copied here too. If the USB is not plugged in, you'll get a warning."
              className="sm:col-span-2"
            >
              <div className="flex gap-2">
                <Input readOnly value={cfg.mirrorFolder ?? ""} placeholder="Not set" />
                <Button variant="outline" onClick={() => chooseFolder("mirrorFolder")}>
                  <Usb /> Choose
                </Button>
                {cfg.mirrorFolder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCfg({ ...cfg, mirrorFolder: null })}
                    aria-label="Remove second folder"
                  >
                    <X />
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </SettingsCard>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="items-center">
          <div>
            <CardTitle>Backups</CardTitle>
            <p className="mt-1 text-muted-foreground text-xs">
              Restore brings the data back to the moment the backup was taken.
            </p>
          </div>
          {canRestore && (
            <Button size="sm" variant="outline" onClick={pickFile}>
              <RotateCcw /> Restore from a file…
            </Button>
          )}
        </CardHeader>
        {s && s.backups.length > 0 ? (
          <Table wrapperClassName="max-h-96">
            <THead>
              <tr>
                <TH>Taken</TH>
                <TH>Type</TH>
                <TH className="text-right">Size</TH>
                {canRestore && <TH />}
              </tr>
            </THead>
            <TBody>
              {s.backups.map((b) => (
                <TR key={b.path}>
                  <TD>
                    {formatDateTime(b.createdAt)}
                    <div className="text-muted-foreground text-xs">{b.fileName}</div>
                  </TD>
                  <TD>
                    <Badge variant={BACKUP_KIND[b.kind].badge}>{BACKUP_KIND[b.kind].label}</Badge>
                  </TD>
                  <TD className="text-right tabular">{bytes(b.sizeBytes)}</TD>
                  {canRestore && (
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => inspect(b.path)}>
                        <RotateCcw /> Restore
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <CardContent>
            <p className="text-muted-foreground text-sm">No backups yet. Press “Back up now”.</p>
          </CardContent>
        )}
      </Card>

      {canExport && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Export to Excel</CardTitle>
              <p className="mt-1 text-muted-foreground text-xs">
                CSV files open directly in Excel or Google Sheets.
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportKind("members", "members")}>
              <Download /> Members
            </Button>
            <Button variant="outline" onClick={() => exportKind("payments", "payments-all")}>
              <Download /> All payments
            </Button>
            <Button variant="outline" onClick={() => exportKind("dues", "fee-dues")}>
              <Download /> Fee dues
            </Button>
            <Button variant="outline" onClick={() => exportKind("expenses", "expenses-all")}>
              <Download /> All expenses
            </Button>
            <Button variant="outline" onClick={() => exportKind("attendance", "attendance-all")}>
              <Download /> All check-ins
            </Button>
          </CardContent>
        </Card>
      )}

      {canManage && <DemoDataCard />}

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="Restore this backup?"
        description={
          restoreTarget && (
            <span className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-success-ink">
                <ShieldCheck className="size-4" /> {restoreTarget.check.message}
              </span>
              <span>
                {restoreTarget.check.gymName ? `Gym: ${restoreTarget.check.gymName}. ` : ""}
                {restoreTarget.check.lastActivity
                  ? `Last activity in backup: ${formatDateTime(restoreTarget.check.lastActivity)}. `
                  : ""}
              </span>
              <span className="font-medium text-foreground">
                Everything entered after that will be replaced. A safety copy of the current data is saved
                first, and everyone must log in again.
              </span>
            </span>
          )
        }
        confirmLabel="Restore now"
        destructive
        onConfirm={async () => {
          if (!restoreTarget) return;
          try {
            await api.backup.restore(restoreTarget.path);
            toast.success("Data restored. Please log in again.");
            setTimeout(() => window.location.reload(), 900);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}

function DemoDataCard() {
  const status = useSession((s) => s.status);
  const [open, setOpen] = useState(false);
  if (!status || status.memberCount > 0) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Practice with demo data</CardTitle>
          <p className="mt-1 text-muted-foreground text-xs">
            Fills this empty gym with a realistic year of sample members, payments and check-ins — useful for
            training staff on a spare PC. Only available while there are no real members.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <FlaskConical /> Load demo data
        </Button>
      </CardHeader>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Load demo data?"
        description="About 250 sample members with a year of history will be created. Do not use this on the gym's real computer unless you plan to restore a backup afterwards."
        confirmLabel="Load demo data"
        onConfirm={async () => {
          try {
            const r = await api.app.demoSeed();
            toast.success(
              `Demo data loaded: ${num(r.members)} members, ${num(r.payments)} payments, ${num(r.checkIns)} check-ins`,
            );
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
