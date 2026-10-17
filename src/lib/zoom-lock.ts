/**
 * One scale for the whole app. A touchpad pinch or Ctrl + mouse wheel would otherwise magnify the page and crop
 * it — it looks "stretched" and stays that way. Bigger text is Settings → Appearance → Text size, which re-flows
 * the layout instead. The desktop shell turns WebView2's zoom off too (src-tauri/src/webview.rs); this catches
 * whatever still reaches the page, e.g. on an older WebView2.
 */
export function lockZoom(target: Window = window) {
  // A touchpad pinch reaches the page as a wheel event with ctrlKey set.
  target.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  target.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "=", "-", "_", "0"].includes(e.key)) e.preventDefault();
  });
}
