// Highlight.js ships one stylesheet per theme, so both are pulled in as inline
// strings and only the active one is mounted. Importing both as real CSS would
// let the second win regardless of the current theme.
import darkCss from "highlight.js/styles/github-dark.css?inline";
import lightCss from "highlight.js/styles/github.css?inline";
import type { ResolvedTheme } from "./theme";

const ID = "hljs-theme";

/** Swap the code-highlighting stylesheet to match the UI theme. */
export function applyHljsTheme(resolved: ResolvedTheme) {
  let el = document.getElementById(ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = ID;
    document.head.appendChild(el);
  }
  el.textContent = resolved === "dark" ? darkCss : lightCss;
}
