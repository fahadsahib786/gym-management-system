import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

export type PaperSize = "80mm" | "58mm" | "a5" | "a4" | "cards";

const PAGE_CSS: Record<PaperSize, string> = {
  "80mm": "@page { margin: 0; } #print-root { width: 72mm; padding: 2mm 3mm; }",
  "58mm": "@page { margin: 0; } #print-root { width: 48mm; padding: 2mm; }",
  a5: "@page { size: A5 portrait; margin: 10mm; } #print-root { width: 100%; }",
  a4: "@page { size: A4 portrait; margin: 12mm; } #print-root { width: 100%; }",
  // Member cards: 2 × 5 credit-card sized cards per A4 sheet.
  cards: "@page { size: A4 portrait; margin: 7mm 0; } #print-root { width: 100%; }",
};

let busy = false;

/**
 * Renders `node` into the hidden #print-root (the only element visible in print CSS) with the page set-up for
 * `paper`, and waits until images are ready. Returns a function that removes it again, or null when another
 * print job is still running.
 */
export async function mountPrint(node: ReactNode, paper: PaperSize): Promise<(() => void) | null> {
  const host = document.getElementById("print-root");
  if (!host || busy) return null;
  busy = true;
  const style = document.createElement("style");
  style.textContent = PAGE_CSS[paper];
  document.head.appendChild(style);
  const root = createRoot(host);
  // Render without flushSync: printing is often triggered from an effect, where a synchronous flush is not allowed.
  root.render(node);
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  // Wait for images (logo, member photos) so they appear on paper; a missing image must not block printing.
  const images = Array.from(host.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    root.unmount();
    style.remove();
    busy = false;
  };
}

/** Prints `node` with the system print dialog. Works with thermal (80/58 mm) and normal printers. */
export async function printNode(node: ReactNode, paper: PaperSize = "80mm"): Promise<void> {
  const unmount = await mountPrint(node, paper);
  if (!unmount) return;
  window.addEventListener("afterprint", unmount, { once: true });
  window.print();
  // Some engines return before printing finishes; keep the content until "afterprint" (or a safety timeout).
  setTimeout(unmount, 60_000);
}
