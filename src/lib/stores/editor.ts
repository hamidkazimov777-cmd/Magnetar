import type { EditorTab } from "./shared";

/** Pinned tabs first, each group keeping the order it already had. */
const sortPinnedFirst = (tabs: EditorTab[]): EditorTab[] => [
  ...tabs.filter((t) => t.pinned),
  ...tabs.filter((t) => !t.pinned),
];
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
  /** Close everything that is not pinned. */
  closeAllTabs: () => void;
  setActiveTab: (path: string) => void;
  /** Pin or unpin a tab. Pinned tabs sort first, so pinning also moves it. */
  togglePin: (path: string) => void;

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
      // A new tab lands after the pinned ones, never among them: pinning is a
      // claim on a position as much as on the tab.
      tabs: s.tabs.some((x) => x.path === tab.path) ? s.tabs : sortPinnedFirst([...s.tabs, tab]),
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
  closeAllTabs: () =>
    set((s) => {
      // "Close all" is for clearing what a search or an agent run left behind.
      // Taking the two files someone deliberately kept is not tidying up.
      const kept = s.tabs.filter((x) => x.pinned);
      return {
        tabs: kept,
        activeTabPath: kept.some((x) => x.path === s.activeTabPath)
          ? s.activeTabPath
          : kept[0]?.path,
      };
    }),
  setActiveTab: (path) => set({ activeTabPath: path, centerView: "editor" }),

  togglePin: (path) =>
    set((s) => ({
      tabs: sortPinnedFirst(
        s.tabs.map((x) => (x.path === path ? { ...x, pinned: !x.pinned } : x)),
      ),
    })),

  // Opening the tab and asking for the line are one intent, so they are one
  // action — otherwise the reveal races the file load.
  revealInFile: (path, line, column) => {
    get().openTab({ path, name: path.split(/[/\\]/).pop() ?? path });
    set({ pendingReveal: { path, line, column } });
  },
  clearReveal: () => set({ pendingReveal: undefined }),
});
