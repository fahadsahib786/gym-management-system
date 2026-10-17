import "@fontsource-variable/inter";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { lockZoom } from "./lib/zoom-lock";
import { initAppearance } from "./stores/ui";

initAppearance();
lockZoom();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
