import { useStore } from "./store";
import { resolveTheme, type ResolvedTheme } from "./theme";

/** The palette actually on screen right now — "system" already collapsed to
 *  light or dark. Components use this for assets (the logo) and for anything
 *  that cannot be expressed as a CSS variable (Monaco, xterm). */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useStore((s) => s.theme);
  return resolveTheme(theme);
}
