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

  /** Whether the user has vouched for the open folder.
   *
   *  Opening a folder is not vouching for what is in it: a repository carries
   *  build scripts and tooling configuration that run as soon as something
   *  touches them. Mirrored here for the UI; the backend refuses on its own. */
  workspaceTrusted: boolean;
  /** Allow changes and commands in the open folder, and remember the choice. */
  trustWorkspace: () => void;
  /** Hand the restored folder to the backend at startup.
   *
   *  The root is persisted in localStorage and comes back on its own, but the
   *  backend learns about it only when `setWorkspaceRoot` runs — which is a user
   *  action. So after a restart the backend believed no folder was open, which
   *  silently disabled path containment and made every folder trusted. */
  adoptRestoredWorkspace: () => Promise<void>;

  /** State of the code-search index for the open folder. */
  indexState: {
    status: "unknown" | "building" | "ready" | "error";
    files?: number;
    /** Files skipped for size or being binary — shown so coverage is honest. */
    skipped?: number;
    at?: number;
  };
  setIndexState: (s: WorkspaceSlice["indexState"]) => void;
}

export const createWorkspaceSlice: Slice<WorkspaceSlice> = (set, get) => ({
  recentFolders: [],
  setWorkspaceRoot: (path) => {
    // The backend decides what is inside the workspace, so it has to be told
    // what the workspace is. Told here rather than at the call sites, because
    // a folder that opens without this is a folder with no containment at all.
    void reportPromise(
      api
        .setWorkspaceRoot(path)
        // Ask rather than assume: a folder opened before may already be
        // trusted, and re-asking about it every launch is how a prompt turns
        // into something people click through without reading.
        .then(() => api.workspaceTrusted())
        .then((workspaceTrusted) => set({ workspaceTrusted })),
      "paths:set_workspace_root",
    );
    // Keep the index following the tree without anyone pressing a button.
    if (path) void reportPromise(api.indexWatch(path), "index:watch");
    set((s) => ({
      workspaceRoot: path,
      recentFolders: path
        ? [path, ...s.recentFolders.filter((p) => p !== path)].slice(0, 8)
        : s.recentFolders,
    }));
  },
  closeFolder: () => {
    void reportPromise(api.setWorkspaceRoot(undefined), "paths:set_workspace_root");
    const closing = get().workspaceRoot;
    if (closing) void reportPromise(api.indexUnwatch(closing), "index:unwatch");
    set({ workspaceTrusted: true }); // nothing open, nothing to distrust
    set({
      workspaceRoot: undefined,
      tabs: [],
      activeTabPath: undefined,
      changes: [],
      activeProjectId: undefined,
    });
  },

  workspaceTrusted: true,
  adoptRestoredWorkspace: async () => {
    const root = get().workspaceRoot;
    if (!root) return;
    await reportPromise(
      api
        .setWorkspaceRoot(root)
        .then(() => api.workspaceTrusted())
        .then((workspaceTrusted) => set({ workspaceTrusted })),
      "paths:adopt_restored_workspace",
    );
  },
  trustWorkspace: () => {
    void reportPromise(
      api.trustWorkspace().then(() => set({ workspaceTrusted: true })),
      "policy:trust_workspace",
    );
  },

  explorerVersion: 0,
  refreshExplorer: () => set((s) => ({ explorerVersion: s.explorerVersion + 1 })),
  gitStatus: {},
  setGitStatus: (map) => set({ gitStatus: map }),

  indexState: { status: "unknown" },
  setIndexState: (indexState) => set({ indexState }),
});
