import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderGit2,
  RefreshCw,
  Brain,
  Loader2,
  TriangleAlert,
  X,
  MoreHorizontal,
  FolderOpen as FolderOpenIcon,
  FolderX,
  Clock,
  FilePlus2,
  FolderPlus,
} from "../icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { analyzeFolderIntoMemory, activateProjectForPath } from "../../lib/memory";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";

/** Open a folder picker, set it as the workspace root and analyze it into the
 *  project memory. Shared by the Explorer, the welcome flow and the palette. */
export async function pickWorkspaceFolder(): Promise<string | undefined> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (typeof selected !== "string") return undefined;
  const st = useStore.getState();
  st.setWorkspaceRoot(selected);
  st.closeAllTabs();
  st.refreshExplorer();
  // Order matters: the project has to be active before the track switch, or
  // switching looks for this project's agent conversation while the previous
  // project is still the current one, and adopts a stranger's chat.
  activateProjectForPath(selected);
  // Opening a project means the user wants the model to work on it — without
  // the agent track the model gets no tools and cannot see a single file.
  useStore.getState().switchTrack("agent");
  void analyzeFolderIntoMemory(selected).catch(() => {});
  return selected;
}

/** Colour per git porcelain letter, matching the Source Control panel. */
const GIT_TONE: Record<string, string> = {
  M: "text-[var(--color-modified)]",
  A: "text-[var(--color-added)]",
  D: "text-[var(--color-removed)]",
  R: "text-[var(--color-info)]",
  U: "text-[var(--color-success)]",
  "•": "text-[var(--color-modified)]",
};

/** A directory entry, once fetched from the backend. */
type Entry = { name: string; isDir: boolean };

/** Per-node state, lifted so the tree can be flattened for virtualization. */
type NodeState = {
  expanded: boolean;
  children: Entry[] | null;
  loading: boolean;
};

/** One row in the flattened, virtualized tree. */
type FlatRow =
  | { kind: "node"; path: string; name: string; isDir: boolean; depth: number; expanded: boolean }
  | { kind: "loading"; path: string; depth: number }
  | { kind: "empty"; path: string; depth: number };

/** Folders first, alphabetical, dotfiles hidden except `.env`. */
function sortEntries(entries: Entry[]): Entry[] {
  return entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".env")
    .sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    );
}

/** Depth-first walk of the expanded part of the tree into a flat row list. */
function flattenTree(
  tree: Record<string, NodeState>,
  rootPath: string,
  rootName: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (path: string, name: string, isDir: boolean, depth: number) => {
    const state = tree[path];
    rows.push({
      kind: "node",
      path,
      name,
      isDir,
      depth,
      expanded: isDir && Boolean(state?.expanded),
    });
    if (!isDir || !state?.expanded) return;
    if (state.loading) {
      rows.push({ kind: "loading", path, depth });
      return;
    }
    if (!state.children) return;
    if (state.children.length === 0) {
      rows.push({ kind: "empty", path, depth });
      return;
    }
    for (const c of state.children) {
      walk(`${path}/${c.name}`, c.name, c.isDir, depth + 1);
    }
  };
  walk(rootPath, rootName, true, 0);
  return rows;
}

/** One row of the tree. Git status is computed here, only for rows that are
 *  actually mounted — off-screen rows cost nothing. */
const TreeRow = memo(function TreeRow({
  row,
  onToggle,
}: {
  row: FlatRow;
  onToggle: (path: string, name: string, isDir: boolean) => void;
}) {
  const t = useT();
  const activeTabPath = useStore((s) => s.activeTabPath);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const gitStatus = useStore((s) => s.gitStatus);

  if (row.kind === "loading") {
    return (
      <div style={{ paddingLeft: 20 + row.depth * 11 }} className="space-y-1 py-1 pr-3">
        <div className="skel h-3 w-2/3" />
        <div className="skel h-3 w-1/2" />
      </div>
    );
  }
  if (row.kind === "empty") {
    return (
      <div
        style={{ paddingLeft: 20 + row.depth * 11 }}
        className="py-1 text-[length:var(--fs-sm)] text-[var(--color-text-mute)]"
      >
        {t("explorerEmptyFolder")}
      </div>
    );
  }

  const { path, name, isDir, depth, expanded } = row;
  // Git reports repo-relative paths; the tree works in absolute ones.
  const rel =
    workspaceRoot && path.startsWith(workspaceRoot)
      ? path.slice(workspaceRoot.length + 1)
      : path;
  const status = isDir
    ? // A folder is marked when anything inside it changed.
      Object.keys(gitStatus).some((p) => p.startsWith(`${rel}/`))
      ? "•"
      : undefined
    : gitStatus[rel];

  return (
    <button
      onClick={() => onToggle(path, name, isDir)}
      title={path}
      style={{ paddingLeft: 6 + depth * 11 }}
      className="row"
      data-active={!isDir && activeTabPath === path}
    >
      {isDir ? (
        <>
          {expanded ? (
            <ChevronDown size={13} className="shrink-0 text-[var(--color-text-mute)]" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-[var(--color-text-mute)]" />
          )}
          {expanded ? (
            <FolderOpen size={14} className="shrink-0 text-[var(--color-accent)]" />
          ) : (
            <Folder size={14} className="shrink-0 text-[var(--color-accent)]" />
          )}
        </>
      ) : (
        <>
          <span className="w-[13px] shrink-0" />
          <FileIcon size={14} className="shrink-0 text-[var(--color-text-mute)]" />
        </>
      )}
      <span className={cn("truncate", status && GIT_TONE[status])}>{name}</span>
      {status && (
        <span
          className={cn(
            "ml-auto shrink-0 pr-1 font-mono text-[length:var(--fs-xs)] font-bold",
            GIT_TONE[status] ?? "text-[var(--color-modified)]",
          )}
        >
          {status}
        </span>
      )}
    </button>
  );
});

export function ExplorerPanel() {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const explorerVersion = useStore((s) => s.explorerVersion);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const memoryError = useStore((s) => s.memoryError);
  const setMemoryError = useStore((s) => s.setMemoryError);
  const openTab = useStore((s) => s.openTab);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<string | null>(null);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createName, setCreateName] = useState("");
  const [tree, setTree] = useState<Record<string, NodeState>>(() =>
    workspaceRoot
      ? { [workspaceRoot]: { expanded: true, children: null, loading: false } }
      : {},
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const rootName = useMemo(
    () => workspaceRoot?.split(/[/\\]/).pop() || workspaceRoot,
    [workspaceRoot],
  );

  const loadChildren = useCallback(async (path: string) => {
    setTree((prev) => ({ ...prev, [path]: { ...prev[path], loading: true } }));
    try {
      const entries = await api.toolListDir(path);
      const visible = sortEntries(entries);
      setTree((prev) => ({
        ...prev,
        [path]: { ...prev[path], children: visible, loading: false },
      }));
    } catch {
      setTree((prev) => ({
        ...prev,
        [path]: { ...prev[path], children: [], loading: false },
      }));
    }
  }, []);

  // Reset the tree and load the root whenever the folder or its refresh
  // version changes — the same remount the old `key` on TreeNode used to do.
  useEffect(() => {
    if (!workspaceRoot) return;
    setTree({
      [workspaceRoot]: { expanded: true, children: null, loading: false },
    });
    void loadChildren(workspaceRoot);
  }, [workspaceRoot, explorerVersion, loadChildren]);

  // Keep the current tree in a ref so the row callback stays stable without
  // re-rendering every visible row on each toggle.
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const toggle = useCallback(
    (path: string, name: string, isDir: boolean) => {
      if (!isDir) {
        openTab({ path, name, kind: "file" });
        return;
      }
      const st = treeRef.current[path] ?? {
        expanded: false,
        children: null,
        loading: false,
      };
      if (!st.expanded && st.children === null) {
        setTree((prev) => ({
          ...prev,
          [path]: {
            ...(prev[path] ?? { expanded: false, children: null, loading: false }),
            expanded: true,
            loading: true,
          },
        }));
        void loadChildren(path);
      } else {
        setTree((prev) => ({
          ...prev,
          [path]: {
            ...(prev[path] ?? { expanded: false, children: null, loading: false }),
            expanded: !st.expanded,
          },
        }));
      }
    },
    [openTab, loadChildren],
  );

  const rows = useMemo(
    () => (workspaceRoot ? flattenTree(tree, workspaceRoot, rootName ?? "") : []),
    [tree, workspaceRoot, rootName],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 12,
    getItemKey: (index) => {
      const r = rows[index];
      return r.kind === "node" ? r.path : `${r.kind}:${r.path}`;
    },
  });


  const finishCreate = async () => {
    if (!creating || !createName.trim() || !workspaceRoot) return;
    const name = createName.trim();
    // basic path join
    const fullPath = workspaceRoot + (workspaceRoot.endsWith("/") ? "" : "/") + name;
    try {
      if (creating === "file") {
        await api.toolWriteFile(fullPath, "");
      } else {
        await api.toolCreateDir(fullPath);
      }
      refreshExplorer();
    } catch (e: any) {
      alert("Error: " + e);
    }
    setCreating(null);
    setCreateName("");
  };

  const analyze = async () => {
    if (!workspaceRoot) return;
    setAnalyzing(true);
    try {
      const p = await analyzeFolderIntoMemory(workspaceRoot);
      setAnalyzed(p?.name ?? null);
    } finally {
      setAnalyzing(false);
    }
  };

  if (!workspaceRoot) {
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("explorerTitle")}</span>
        </header>
        <EmptyState
          icon={FolderGit2}
          title={t("explorerNoFolder")}
          text={t("explorerNoFolderHint")}
          action={{ label: t("explorerOpenFolder"), onClick: () => void pickWorkspaceFolder() }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1 truncate" title={workspaceRoot}>
          {rootName}
        </span>
        <button className="icon-btn" title={t("newFile") || "New File"} onClick={() => { setCreating("file"); setCreateName(""); }}>
          <FilePlus2 size={14} />
        </button>
        <button className="icon-btn" title={t("newFolder") || "New Folder"} onClick={() => { setCreating("dir"); setCreateName(""); }}>
          <FolderPlus size={14} />
        </button>
        <button
          className="icon-btn"
          title={
            analyzing
              ? t("memAnalyzing")
              : analyzed
                ? `${t("memInMemory")}: ${analyzed}`
                : `${t("memAnalyze")} — ${t("memAnalyzeHint")}`
          }
          onClick={analyze}
          disabled={analyzing}
          data-active={Boolean(analyzed)}
        >
          {analyzing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Brain size={14} />
          )}
        </button>
        <button className="icon-btn" title={t("explorerRefresh")} onClick={refreshExplorer}>
          <RefreshCw size={14} />
        </button>
        <FolderMenu />
      </header>

      
      {creating && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
          {creating === "file" ? <FilePlus2 size={13} className="opacity-70" /> : <FolderPlus size={13} className="opacity-70" />}
          <input
            autoFocus
            className="input w-full bg-[var(--color-surface-2)] text-[length:var(--fs-xs)] px-1.5 py-0.5 min-h-[22px]"
            placeholder={creating === "file" ? "File name..." : "Folder name..."}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void finishCreate();
              if (e.key === "Escape") setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </div>
      )}

      {analyzing && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-accent-strong)]">
          <Loader2 size={12} className="animate-spin" />
          {t("memAnalyzing")}
        </div>
      )}

      {!analyzing && memoryError && (
        <div className="alert m-2 flex-col items-stretch text-[length:var(--fs-xs)]">
          <div className="flex items-start gap-2">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t("memErrTitle")}</div>
              <p className="mt-1 break-words opacity-90">
                {/* Known causes come through as i18n keys; anything else is the
                    provider's own message, shown verbatim. */}
                {memoryError.startsWith("memErr") ? t(memoryError) : memoryError}
              </p>
            </div>
            <button
              className="icon-btn h-5 w-5 shrink-0"
              onClick={() => setMemoryError(undefined)}
              title={t("errorDismiss")}
            >
              <X size={11} />
            </button>
          </div>
          <button className="btn btn-sm btn-secondary mt-2 self-start" onClick={analyze}>
            {t("memRetry")}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1 pr-1">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <TreeRow row={row} onToggle={toggle} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Folder actions: switch, reopen a recent one, or close the current folder.
 *  Closing was previously impossible — the root could only ever be replaced. */
function FolderMenu() {
  const t = useT();
  const recentFolders = useStore((s) => s.recentFolders);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const setWorkspaceRoot = useStore((s) => s.setWorkspaceRoot);
  const closeFolder = useStore((s) => s.closeFolder);
  const closeAllTabs = useStore((s) => s.closeAllTabs);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchTo = (path: string) => {
    setWorkspaceRoot(path);
    closeAllTabs();
    refreshExplorer();
    activateProjectForPath(path);
    void analyzeFolderIntoMemory(path).catch(() => {});
    setOpen(false);
  };

  const others = recentFolders.filter((p) => p !== workspaceRoot);

  return (
    <div ref={ref} className="relative">
      <button
        className="icon-btn"
        title={t("explorerFolderActions")}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="anim-in absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-[var(--e-3)]">
          <button
            className="row"
            onClick={() => {
              setOpen(false);
              void pickWorkspaceFolder();
            }}
          >
            <FolderOpenIcon size={14} className="shrink-0 opacity-80" />
            <span className="truncate">{t("explorerChangeFolder")}</span>
          </button>
          <button
            className="row"
            onClick={() => {
              closeFolder();
              setOpen(false);
            }}
          >
            <FolderX size={14} className="shrink-0 opacity-80" />
            <span className="truncate">{t("explorerCloseFolder")}</span>
          </button>

          {others.length > 0 && (
            <>
              <div className="section-label flex items-center gap-1.5">
                <Clock size={11} /> {t("explorerRecent")}
              </div>
              {others.map((p) => (
                <button key={p} className="row" title={p} onClick={() => switchTo(p)}>
                  <FolderGit2 size={14} className="shrink-0 opacity-70" />
                  <span className="truncate">{p.split(/[/\\]/).pop()}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
