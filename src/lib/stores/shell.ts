import { api } from "../api";
import { reportPromise } from "../errors";
import type { Lang } from "../i18n";
import { applyTheme, type Theme } from "../theme";
import { DEFAULT_PREFS, type CenterView, type Prefs, type SidePanel } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   THE SHELL

   Everything about how the workspace is laid out and how the app behaves,
   as opposed to what it is working on. All of it is persisted: a window that
   forgets which panel was open is a window you have to set up again every
   morning.
   ========================================================================== */

export interface ShellSlice {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;

  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Light / dark / follow-OS. Light is the default on a fresh install. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Learn mode: hover any control to get a short explanation of what it does
   *  and when it runs. */
  hintsOn: boolean;
  toggleHints: (v?: boolean) => void;
  /** Per subscription provider: present a desktop Safari user agent in the
   *  embedded browser, because some sign-in flows refuse the plain webview. */
  subsSafariUa: Record<string, boolean>;
  setSubsSafariUa: (providerId: string, on: boolean) => void;

  /** False until the user finishes (or skips) the first-launch walkthrough. */
  /** Read-only mode: the app may look at the project but not change it.
   *
   *  Mirrored here for the UI only. The backend holds the real switch and
   *  refuses writes and shell commands itself, so a compromised page cannot
   *  turn it off by flipping a boolean in the store. Not persisted: leaving it
   *  on across launches would make it a setting nobody notices rather than a
   *  choice somebody makes. */
  readOnly: boolean;
  setReadOnly: (on: boolean) => void;

  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
  sidePanel: SidePanel;
  sidebarOpen: boolean;
  setSidePanel: (p: SidePanel) => void;
  toggleSidebar: () => void;
  centerView: CenterView;
  setCenterView: (v: CenterView) => void;
  terminalOpen: boolean;
  toggleTerminal: (v?: boolean) => void;
  agentPanelOpen: boolean;
  toggleAgentPanel: (v?: boolean) => void;
}

export const createShellSlice: Slice<ShellSlice> = (set) => ({
  prefs: DEFAULT_PREFS,
  setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),

  lang: "ru",
  setLang: (lang) => set({ lang }),
  theme: "light",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  hintsOn: false,
  toggleHints: (v) => set((s) => ({ hintsOn: v ?? !s.hintsOn })),
  // Gemini defaults to on: it is behind Google sign-in, which is exactly
  // the flow the plain webview user agent gets refused for.
  subsSafariUa: { gemini: true },
  setSubsSafariUa: (providerId, on) =>
    set((s) => ({ subsSafariUa: { ...s.subsSafariUa, [providerId]: on } })),

  readOnly: false,
  setReadOnly: (on) => {
    void reportPromise(api.setReadOnly(on), "policy:set_read_only");
    set({ readOnly: on });
  },

  onboarded: false,
  setOnboarded: (v) => set({ onboarded: v }),
  sidePanel: "explorer",
  sidebarOpen: true,
  setSidePanel: (p) =>
    set((s) => ({
      sidePanel: p,
      // Clicking the active icon collapses the panel, like VS Code.
      sidebarOpen: s.sidePanel === p ? !s.sidebarOpen : true,
    })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  centerView: "editor",
  setCenterView: (v) =>
    set(
      // Project pages need a project selected — surface the picker with them.
      v === "projects" || v === "roadmap" || v === "knowledge" || v === "timeline"
        ? { centerView: v, sidePanel: "project", sidebarOpen: true }
        : { centerView: v },
    ),
  terminalOpen: false,
  toggleTerminal: (v) => set((s) => ({ terminalOpen: v ?? !s.terminalOpen })),
  agentPanelOpen: true,
  toggleAgentPanel: (v) =>
    set((s) => ({ agentPanelOpen: v ?? !s.agentPanelOpen })),
});
