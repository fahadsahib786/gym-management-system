import type { BackupKind } from "@/api/bindings";
import type { BadgeVariant } from "@/components/ui/primitives";

/** How each kind of backup is named in the app. */
export const BACKUP_KIND: Record<BackupKind, { label: string; badge: BadgeVariant }> = {
  auto: { label: "Automatic", badge: "neutral" },
  manual: { label: "Manual", badge: "primary" },
  safety: { label: "Before restore", badge: "warning" },
  update: { label: "Before update", badge: "info" },
  uninstall: { label: "Before uninstall", badge: "info" },
};
