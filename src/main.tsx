import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// UI font: the platform stack does the work (SF Pro on macOS); Onest is the
// bundled fallback so Cyrillic stays consistent off-platform. Offline either way.
import "@fontsource/onest/latin-400.css";
import "@fontsource/onest/latin-500.css";
import "@fontsource/onest/latin-600.css";
import "@fontsource/onest/latin-700.css";
import "@fontsource/onest/cyrillic-400.css";
import "@fontsource/onest/cyrillic-500.css";
import "@fontsource/onest/cyrillic-600.css";
import "@fontsource/onest/cyrillic-700.css";
// JetBrains Mono for code — bundled locally (offline), Latin + Cyrillic.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "./lib/monaco";
import "./index.css";
import { useStore } from "./lib/store";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { applyHljsTheme } from "./lib/hljs-theme";
import { setMonacoTheme } from "./lib/monaco";

// Paint the persisted theme before React's first render so there is no flash of
// the wrong palette. Zustand's persist middleware rehydrates synchronously.
let lastResolved: string | null = null;
function syncTheme() {
  const resolved = applyTheme(useStore.getState().theme);
  if (resolved === lastResolved) return;
  lastResolved = resolved;
  applyHljsTheme(resolved);
  setMonacoTheme(resolved);
}
syncTheme();
useStore.subscribe(syncTheme);
watchSystemTheme(syncTheme);

// Dev-only: expose the store so context/state can be inspected from the console.
if (import.meta.env.DEV) {
  (window as unknown as { __magnetar?: unknown }).__magnetar = useStore;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
