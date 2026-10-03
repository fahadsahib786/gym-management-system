import { save } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorMessage } from "@/api/errors";
import { mountPrint } from "./print";

export type PdfPaper = "a5" | "a4" | "cards";

/** A file name Windows accepts: `Receipt R-000123 - Ali Khan.pdf`. */
export function pdfFileName(...parts: (string | null | undefined)[]): string {
  const name = parts
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${name || "Document"}.pdf`;
}

/**
 * Asks where to save, then writes `node` as a PDF exactly as it would print (selectable text, logo, photos).
 * Returns the saved path, or null when cancelled or failed (the error is shown).
 */
export async function saveAsPdf(node: ReactNode, paper: PdfPaper, fileName: string): Promise<string | null> {
  // End-to-end tests answer the "Save as" dialog through this hook; it is never set in normal use.
  const testPath = (window as { __DF_SAVE_PATH__?: string }).__DF_SAVE_PATH__;
  const path =
    testPath ??
    (await save({
      title: "Save as PDF",
      defaultPath: fileName,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    }));
  if (!path) return null;
  const unmount = await mountPrint(node, paper);
  if (!unmount) {
    toast.error("Another document is being printed. Try again in a moment.");
    return null;
  }
  try {
    await api.app.savePdf(path, paper);
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  } finally {
    unmount();
  }
  toast.success("PDF saved", {
    description: path.split(/[\\/]/).pop(),
    duration: 10_000,
    action: { label: "Open", onClick: () => void api.app.openFile(path) },
    cancel: { label: "Show in folder", onClick: () => void api.app.revealFile(path) },
  });
  return path;
}
