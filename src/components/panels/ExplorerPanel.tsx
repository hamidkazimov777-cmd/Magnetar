import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
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
  // Opening a project means the user wants the model to work on it — without
  // agent mode the model gets no tools and cannot see a single file.
  st.setAgentMode(true);
  activateProjectForPath(selected);
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

function TreeNode({
  path,
  name,
  isDir,
  depth,
  defaultExpanded = false,
}: {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  defaultExpanded?: boolean;
}) {
  const openTab = useStore((s) => s.openTab);
  const activeTabPath = useStore((s) => s.activeTabPath);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const gitStatus = useStore((s) => s.gitStatus);
  const t = useT();

  // Git reports repo-relative paths; the tree works in absolute ones.
  const rel = workspaceRoot && path.startsWith(workspaceRoot)
    ? path.slice(workspaceRoot.length + 1)
    : path;
  const status = isDir
    ? // A folder is marked when anything inside it changed.
      Object.keys(gitStatus).some((p) => p.startsWith(`${rel}/`))
      ? "•"
      : undefined
    : gitStatus[rel];

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [children, setChildren] = useState<{ name: string; isDir: boolean }[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const entries = await api.toolListDir(path);
      // Hide dotfiles except .env, then folders first, alphabetical.
      const visible = entries
        .filter((e) => !e.name.startsWith(".") || e.name === ".env")
        .sort((a, b) =>
          a.isDir === b.isDir
            ? a.name.localeCompare(b.name)
            : a.isDir
              ? -1
              : 1,
        );
      setChildren(visible);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (defaultExpanded && isDir && children === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    if (!isDir) {
      openTab({ path, name, kind: "file" });
      return;
    }
    if (!expanded && children === null) await load();
    setExpanded((v) => !v);
  };

  return (
    <div>
      <button
        onClick={toggle}
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

      {expanded && (
        <div>
          {loading && (
            <div style={{ paddingLeft: 20 + depth * 11 }} className="space-y-1 py-1 pr-3">
              <div className="skel h-3 w-2/3" />
              <div className="skel h-3 w-1/2" />
            </div>
          )}
          {!loading && children?.length === 0 && (
            <div
              style={{ paddingLeft: 20 + depth * 11 }}
              className="py-1 text-[length:var(--fs-sm)] text-[var(--color-text-mute)]"
            >
              {t("explorerEmptyFolder")}
            </div>
          )}
          {children?.map((c) => (
            <TreeNode
              key={c.name}
              path={`${path}/${c.name}`}
              name={c.name}
              isDir={c.isDir}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplorerPanel() {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const explorerVersion = useStore((s) => s.explorerVersion);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const memoryError = useStore((s) => s.memoryError);
  const setMemoryError = useStore((s) => s.setMemoryError);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<string | null>(null);

  const rootName = useMemo(
    () => workspaceRoot?.split(/[/\\]/).pop() || workspaceRoot,
    [workspaceRoot],
  );

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

      <div className={cn("min-h-0 flex-1 overflow-auto py-1 pr-1")}>
        <TreeNode
          key={`${workspaceRoot}:${explorerVersion}`}
          path={workspaceRoot}
          name={rootName || workspaceRoot}
          isDir
          depth={0}
          defaultExpanded
        />
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
