import type { EditorTab } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   EDITOR TABS

   Tabs are store state rather than editor state because the agent, Source
   Control, Problems and search all open files. `revealInFile` opens the tab
   and records the line in one action: split in two they raced, and the reveal
   arrived before the file did.
   ========================================================================== */

export interface EditorSlice {
  tabs: EditorTab[];
  activeTabPath?: string;
  openTab: (tab: EditorTab) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string) => void;

  /** Line a newly opened tab should scroll to (set by Problems / Search).
   *  The editor consumes and clears it once the file is on screen. */
  pendingReveal?: { path: string; line: number; column?: number };
  revealInFile: (path: string, line: number, column?: number) => void;
  clearReveal: () => void;
}

export const createEditorSlice: Slice<EditorSlice> = (set, get) => ({
  tabs: [],
  openTab: (tab) =>
    set((s) => ({
      tabs: s.tabs.some((x) => x.path === tab.path) ? s.tabs : [...s.tabs, tab],
      activeTabPath: tab.path,
      centerView: "editor",
    })),
  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((x) => x.path === path);
      const tabs = s.tabs.filter((x) => x.path !== path);
      if (s.activeTabPath !== path) return { tabs };
      // Focus the neighbour that takes the closed tab's place.
      const next = tabs[Math.min(idx, tabs.length - 1)];
      return { tabs, activeTabPath: next?.path };
    }),
  closeAllTabs: () => set({ tabs: [], activeTabPath: undefined }),
  setActiveTab: (path) => set({ activeTabPath: path, centerView: "editor" }),

  // Opening the tab and asking for the line are one intent, so they are one
  // action — otherwise the reveal races the file load.
  revealInFile: (path, line, column) => {
    get().openTab({ path, name: path.split(/[/\\]/).pop() ?? path });
    set({ pendingReveal: { path, line, column } });
  },
  clearReveal: () => set({ pendingReveal: undefined }),
});
