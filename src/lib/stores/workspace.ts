import { api } from "../api";
import { reportPromise } from "../errors";
import type { Slice } from "./state";

/* ==========================================================================
   THE OPEN FOLDER

   The folder is the unit of work: closing one has to clear everything that
   only made sense inside it, or the next folder opens showing the last one's
   tabs and unreviewed edits.
   ========================================================================== */

export interface WorkspaceSlice {
  workspaceRoot?: string;
  setWorkspaceRoot: (path: string | undefined) => void;
  /** Most-recently opened folders, newest first (for the welcome screen). */
  recentFolders: string[];
  closeFolder: () => void;

  /** Bumped to force the file tree to re-read from disk (after agent edits). */
  explorerVersion: number;
  refreshExplorer: () => void;
  /** Git status letter per repo-relative path, for badges in the file tree. */
  gitStatus: Record<string, string>;
  setGitStatus: (map: Record<string, string>) => void;

  /** State of the code-search index for the open folder. */
  indexState: { status: "unknown" | "building" | "ready" | "error"; files?: number; at?: number };
  setIndexState: (s: WorkspaceSlice["indexState"]) => void;
}

export const createWorkspaceSlice: Slice<WorkspaceSlice> = (set) => ({
  recentFolders: [],
  setWorkspaceRoot: (path) => {
    // The backend decides what is inside the workspace, so it has to be told
    // what the workspace is. Told here rather than at the call sites, because
    // a folder that opens without this is a folder with no containment at all.
    void reportPromise(api.setWorkspaceRoot(path), "paths:set_workspace_root");
    set((s) => ({
      workspaceRoot: path,
      recentFolders: path
        ? [path, ...s.recentFolders.filter((p) => p !== path)].slice(0, 8)
        : s.recentFolders,
    }));
  },
  closeFolder: () => {
    void reportPromise(api.setWorkspaceRoot(undefined), "paths:set_workspace_root");
    set({
      workspaceRoot: undefined,
      tabs: [],
      activeTabPath: undefined,
      changes: [],
      activeProjectId: undefined,
    });
  },

  explorerVersion: 0,
  refreshExplorer: () => set((s) => ({ explorerVersion: s.explorerVersion + 1 })),
  gitStatus: {},
  setGitStatus: (map) => set({ gitStatus: map }),

  indexState: { status: "unknown" },
  setIndexState: (indexState) => set({ indexState }),
});
