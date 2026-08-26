import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createAgentRunSlice } from "./stores/agentRun";
import { createAppSlice } from "./stores/app";
import { createDiagnosticsSlice } from "./stores/diagnostics";
import { createEditorSlice } from "./stores/editor";
import { createMemorySlice } from "./stores/memory";
import { createProjectsSlice } from "./stores/projects";
import { createProvidersSlice } from "./stores/providers";
import { createSessionsSlice } from "./stores/sessions";
import { DEFAULT_PREFS } from "./stores/shared";
import { createShellSlice } from "./stores/shell";
import type { State } from "./stores/state";
import { createWorkspaceSlice } from "./stores/workspace";

/* ==========================================================================
   THE STORE

   One store, composed from domain slices in `src/lib/stores/`. It is one store
   on purpose: the domains genuinely touch each other — closing a folder clears
   editor tabs and unreviewed changes, selecting a project re-points the live
   conversation, revealing a problem opens a tab — and splitting those into
   separate stores would only move the coupling somewhere harder to see.

   What the split fixes is readability: each domain's data and the actions that
   own it now live in one file, instead of thirteen hundred lines where the
   provider list and the agent trace sat forty lines apart.

   Persistence stays here, because it is a decision about the store as a whole:
   the canon (sessions, messages) and connections live in SQLite, and only
   small, losable preferences go to localStorage.
   ========================================================================== */

export type { State } from "./stores/state";
export {
  DEFAULT_PREFS,
  NEW_CHAT_TITLE,
  type CenterView,
  type EditorTab,
  type FileChange,
  type Prefs,
  type SidePanel,
} from "./stores/shared";

export const useStore = create<State>()(
  persist(
    (...a) => ({
      ...createProvidersSlice(...a),
      ...createShellSlice(...a),
      ...createWorkspaceSlice(...a),
      ...createEditorSlice(...a),
      ...createSessionsSlice(...a),
      ...createProjectsSlice(...a),
      ...createMemorySlice(...a),
      ...createDiagnosticsSlice(...a),
      ...createAgentRunSlice(...a),
      ...createAppSlice(...a),
    }),
    {
      name: "magnetar-store",
      /** Saved preferences are older than the code reading them.
       *
       *  zustand replaces state with what it restored, so a `prefs` object
       *  written before a field existed comes back missing that field — and
       *  the first component to read it crashes. That is exactly what
       *  `subagentRoster` did: an agent panel that had never seen the new
       *  setting rendered `undefined.length` and took the whole panel down.
       *
       *  Every future field has the same problem, so the fix belongs here:
       *  defaults first, saved values on top.
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...saved,
          prefs: { ...DEFAULT_PREFS, ...(saved.prefs ?? {}) },
        };
      },
      // Canon (sessions) + connections live in SQLite; models re-warm at startup.
      // Keep only small, non-critical preferences in localStorage.
      partialize: (s) => ({
        activeConnectionId: s.activeConnectionId,
        activeModel: s.activeModel,
        adaptive: s.adaptive,
        activeTrack: s.activeTrack,
        workspaceRoot: s.workspaceRoot,
        recentFolders: s.recentFolders,
        prefs: s.prefs,
        modelStatus: s.modelStatus,
        modelTools: s.modelTools,
        lang: s.lang,
        theme: s.theme,
        hintsOn: s.hintsOn,
        subsSafariUa: s.subsSafariUa,
        activeProjectId: s.activeProjectId,
        onboarded: s.onboarded,
        sidePanel: s.sidePanel,
        sidebarOpen: s.sidebarOpen,
        agentPanelOpen: s.agentPanelOpen,
        terminalOpen: s.terminalOpen,
        tabs: s.tabs,
        activeTabPath: s.activeTabPath,
        memoryLog: s.memoryLog.slice(0, 30),
      }),
    },
  ),
);
