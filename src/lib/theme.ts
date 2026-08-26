import { invoke } from "@tauri-apps/api/core";

/** Light is the product default. "system" follows the OS, and is only ever
 *  chosen explicitly by the user — a fresh install starts light. */
export type Theme = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

const mql = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  return mql()?.matches ? "dark" : "light";
}

/** Write the theme onto <html>. Every colour token keys off this attribute, so
 *  this one line is the whole switch — no component re-styles itself. */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  // Tell the native shell which colour to paint the window on next launch, so
  // startup never flashes the opposite theme before the webview appears.
  void invoke("persist_window_theme", { dark: resolved === "dark" }).catch(() => {});
  return resolved;
}

/** Keep "system" live while the app is open. Returns an unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}
