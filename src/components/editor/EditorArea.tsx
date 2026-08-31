import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { X, Save, FileCode2, GitCompare, Loader2, Info, Copy, Check, Pin, Columns } from "../icons";
import { copyText } from "../../lib/clipboard";
import { api } from "../../lib/api";
import { useStore, type EditorTab } from "../../lib/store";
import { syncCheckMarkers } from "../../lib/markers";
import * as lsp from "../../lib/lspManager";
import { registerLspProviders, installDefinitionOpener } from "../../lib/lspEditor";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { DiffView } from "./DiffView";
import type * as monaco from "monaco-editor";
import { monacoThemeFor, languageForPath, loadMonaco } from "../../lib/monaco";
import { useResolvedTheme } from "../../lib/useTheme";
import { outlineOf, trailAt } from "../../lib/outline";
import { blame as gitBlame, fileHistory, type BlameLine } from "../../lib/git";
import { relativeTime } from "../../lib/relativeTime";

const tabKey = (tab: EditorTab) =>
  `${tab.kind === "diff" ? "diff" : "file"}:${tab.staged ? "s:" : ""}${tab.path}`;

/** The center of the workspace: a VS Code-style tab strip over Monaco — the
 *  same editor engine VS Code uses, bundled locally so it works offline. */
export function EditorArea() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const activeTabPath = useStore((s) => s.activeTabPath);
  const togglePin = useStore((s) => s.togglePin);
  const splitPath = useStore((s) => s.splitTabPath);
  /** Which line the cursor is on, so the breadcrumb trail can say which
   *  function you are looking at rather than only which file. */
  const [cursorLine, setCursorLine] = useState(1);
  const lang = useStore((s) => s.lang);
  const breakpoints = useStore((s) => s.breakpoints);
  const activeRef = useRef<string | undefined>(undefined);
  /** GitLens-style current-line blame: who last touched the line under the
   *  cursor, shown after it. Off until asked for — it costs a git call per
   *  file and most reading does not need it. */
  const [blameOn, setBlameOn] = useState(false);
  const blameRef = useRef<BlameLine[] | null>(null);
  const blameDecoration = useRef<string[]>([]);
  const setSplitTab = useStore((s) => s.setSplitTab);
  const autosave = useStore((s) => s.prefs.autosave);
  const formatOnSave = useStore((s) => s.prefs.formatOnSave);
  const autosaveDelayMs = useStore((s) => s.prefs.autosaveDelayMs);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const openTab = useStore((s) => s.openTab);
  const revealInFile = useStore((s) => s.revealInFile);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const prefs = useStore((s) => s.prefs);
  const resolvedTheme = useResolvedTheme();

  const active = tabs.find((x) => x.path === activeTabPath) ?? tabs[0];

  // A configured-but-not-installed language server for the open file: surface an
  // actionable hint (3.4) instead of silently giving no analysis.
  const lspMissing = useStore((s) => s.lspMissing);
  const lspKey = active?.kind === "file" ? lsp.serverKeyForPath(active.path) : undefined;
  const missingServer = lspKey ? lspMissing[lspKey] : undefined;
  const [dismissedLsp, setDismissedLsp] = useState<Set<string>>(new Set());
  const [copiedInstall, setCopiedInstall] = useState(false);

  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [monacoReady, setMonacoReady] = useState(false);
  const loadedRef = useRef<Set<string>>(new Set());
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const blameRoot = useStore((s) => s.workspaceRoot);
  /** Cursor position per path, so switching tabs returns you where you were. */
  const viewStates = useRef<Record<string, monaco.editor.ICodeEditorViewState | null>>({});

  // Monaco is heavy, so it loads on first use instead of at app start. The
  // editor and diff views render a skeleton until the engine is ready.
  useEffect(() => {
    if (tabs.length === 0) return;
    let cancelled = false;
    void loadMonaco().then(() => {
      if (!cancelled) setMonacoReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tabs.length]);

  // Theme synchronization stays on the editor route; loading the theme module
  // from main.tsx would pull Monaco's multi-megabyte engine into the first chunk.
  useEffect(() => {
    if (!monacoReady) return;
    void loadMonaco().then((m) => m.editor.setTheme(monacoThemeFor(resolvedTheme)));
  }, [monacoReady, resolvedTheme]);

  // Load a file's content once per path.
  //
  // Takes a path rather than reading the active tab, because the split pane
  // needs the same thing done for a second file — and a pane that renders an
  // empty buffer because nothing loaded it is a bug that looks like an empty
  // file.
  const loadFile = useCallback(
    (path: string | undefined) => {
      if (!path || loadedRef.current.has(path)) return;
      loadedRef.current.add(path);
      void api
        .editorReadFile(path)
        .then((text) => {
          setBuffers((b) => ({ ...b, [path]: text }));
          // Hand the freshly loaded document to its language server, if one is
          // installed. Best-effort: never let this disturb the editor.
          void lsp.didOpen(path, text).catch(() => {});
        })
        .catch((e) => {
          // A directory is not an editor error worth a red banner across the
          // whole editor — just close the tab that should never have opened.
          if (/is a directory/i.test(String(e))) {
            loadedRef.current.delete(path);
            closeTab(path);
            return;
          }
          setError(`${t("editorOpenError")}: ${String(e)}`);
          setBuffers((b) => ({ ...b, [path]: "" }));
        });
    },
    [closeTab, t],
  );

  useEffect(() => {
    if (active && active.kind !== "diff") loadFile(active.path);
    activeRef.current = active && active.kind !== "diff" ? active.path : undefined;
  }, [active, loadFile]);

  // Paint breakpoint markers whenever they change or the file switches.
  const bpDecoration = useRef<string[]>([]);
  useEffect(() => {
    const ed = editorRef.current;
    const m = monacoRef.current;
    if (!ed || !m || !active || active.kind === "diff") return;
    const lines = breakpoints[active.path] ?? [];
    bpDecoration.current = ed.deltaDecorations(
      bpDecoration.current,
      lines.map((line) => ({
        range: new m.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-glyph",
          glyphMarginHoverMessage: { value: "breakpoint" },
        },
      })),
    );
  }, [breakpoints, active, buffers]);

  useEffect(() => {
    loadFile(splitPath);
  }, [splitPath, loadFile]);

  // Blame data follows the active file while the mode is on.
  useEffect(() => {
    blameRef.current = null;
    if (blameDecoration.current.length && editorRef.current)
      blameDecoration.current = editorRef.current.deltaDecorations(blameDecoration.current, []);
    if (!blameOn || !blameRoot || !active || active.kind === "diff") return;
    const rel = active.path.startsWith(blameRoot + "/")
      ? active.path.slice(blameRoot.length + 1)
      : active.path;
    void gitBlame(blameRoot, rel).then((lines) => {
      blameRef.current = lines;
    });
  }, [blameOn, blameRoot, active]);

  // The annotation itself, redrawn as the cursor moves.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!blameOn || !blameRef.current) {
      if (blameDecoration.current.length)
        blameDecoration.current = ed.deltaDecorations(blameDecoration.current, []);
      return;
    }
    if (!monacoRef.current) return;
    const info = blameRef.current.find((b) => b.line === cursorLine);
    if (!info) {
      blameDecoration.current = ed.deltaDecorations(blameDecoration.current, []);
      return;
    }
    // The all-zero sha is an uncommitted line: saying "not committed" is the
    // honest answer, rather than attributing it to whoever is above it.
    const text = /^0+$/.test(info.sha)
      ? t("blameUncommitted")
      : `${info.author}, ${relativeTime(info.time, lang === "ru" || lang === "es" ? lang : "en")}`;
    blameDecoration.current = ed.deltaDecorations(blameDecoration.current, [
      {
        range: new (monacoRef.current as typeof monaco).Range(cursorLine, 1, cursorLine, 1),
        options: {
          after: {
            content: `      ${text}`,
            inlineClassName: "blame-annotation",
          },
        },
      },
    ]);
  }, [blameOn, cursorLine, t, lang]);

  // Forget buffers for tabs that were closed, so reopening re-reads from disk.
  useEffect(() => {
    const open = new Set(tabs.filter((x) => x.kind !== "diff").map((x) => x.path));
    const closed: string[] = [];
    for (const p of Array.from(loadedRef.current))
      if (!open.has(p)) {
        loadedRef.current.delete(p);
        delete viewStates.current[p];
        lsp.didClose(p);
        closed.push(p);
      }
    // Also drop the in-memory buffer and the dirty flag for closed tabs —
    // otherwise reopening a file discarded without saving still shows the
    // unsaved dot even though it re-reads clean from disk.
    if (closed.length) {
      setBuffers((b) => {
        const next = { ...b };
        for (const p of closed) delete next[p];
        return next;
      });
      setDirty((d) => {
        const next = { ...d };
        for (const p of closed) delete next[p];
        return next;
      });
      // Dispose the Monaco model too. Without this, Monaco keeps the closed
      // file's model with its unsaved edits, and reopening reuses that stale
      // model instead of re-reading the (clean) file from disk.
      void loadMonaco().then((m) => {
        for (const p of closed) {
          const model = m.editor.getModels().find((md) => md.uri.path === p);
          if (model && model !== editorRef.current?.getModel()) model.dispose();
        }
      });
    }
  }, [tabs]);

  const saveRef = useRef<() => Promise<void>>(async () => {});

  const save = useCallback(async () => {
    if (!active || active.kind === "diff") return;
    let content = buffers[active.path];
    if (content === undefined) return;
    setSaving(true);
    setError(null);
    try {
      // Formatting is the project's decision, so it goes through the language
      // server's formatter rather than any opinion of ours. Run before the
      // write and read back from the model, so what lands on disk is what the
      // editor now shows — formatting after the write would leave the two
      // disagreeing until the next keystroke.
      if (formatOnSave && editorRef.current) {
        try {
          await editorRef.current.getAction("editor.action.formatDocument")?.run();
          content = editorRef.current.getValue();
          setBuffers((b) => ({ ...b, [active.path]: content as string }));
        } catch {
          // No formatter, or one that failed: save what the user wrote. A save
          // that refuses because formatting did not work would lose the edit.
        }
      }
      await api.toolWriteFile(active.path, content);
      setDirty((d) => ({ ...d, [active.path]: false }));
      refreshExplorer();
    } catch (e) {
      setError(`${t("editorSaveError")}: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [active, buffers, formatOnSave, refreshExplorer, t]);

  saveRef.current = save;

  // Autosave: write the file once it has stopped changing.
  //
  // Off by default, and debounced rather than on every keystroke — saving
  // mid-word means every file watcher, formatter and dev server in the project
  // reacts to a state the user never intended to create. The delay restarts
  // with each edit, so the write happens when typing stops.
  useEffect(() => {
    if (!autosave || !active || active.kind === "diff") return;
    if (!dirty[active.path]) return;
    const timer = setTimeout(() => void save(), Math.max(200, autosaveDelayMs));
    return () => clearTimeout(timer);
  }, [autosave, autosaveDelayMs, active, dirty, buffers, save]);

  // ⌘S saves, ⌘W closes. Registered on window so they work even when Monaco
  // does not have focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "s") {
        e.preventDefault();
        if (active && dirty[active.path]) void save();
      }
      if (e.key === "w" && active) {
        e.preventDefault();
        closeTab(active.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, dirty, save, closeTab]);

  const onMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    // Monaco owns ⌘S inside the editor; wire it to the same save path.
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => void saveRef.current(),
    );
    // Wire language-server features (hover, definition, …) to the editor.
    // Idempotent — safe on every mount.
    registerLspProviders(monacoInstance);
    installDefinitionOpener(editor, { openTab, revealInFile });
    // The breadcrumb trail follows the cursor, so it has to hear about it.
    setCursorLine(editor.getPosition()?.lineNumber ?? 1);
    editor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber));

    // Breakpoints: a click in the glyph margin toggles one on that line, the
    // way every editor does it. The margin is enabled in the options below.
    editor.onMouseDown((e) => {
      if (e.target.type !== monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = e.target.position?.lineNumber;
      const path = activeRef.current;
      if (line && path) useStore.getState().toggleBreakpoint(path, line);
    });
  };

  // Errors from the project's own checks belong under the code, not only in a
  // panel. Re-synced when a check finishes and when a tab opens, because a
  // problem found while the file was closed still has to show up on opening.
  const checkRuns = useStore((s) => s.checkRuns);
  useEffect(() => {
    void syncCheckMarkers(checkRuns);
  }, [checkRuns, active?.path, buffers]);

  // Jump to a line requested from elsewhere (Problems panel). Runs after the
  // buffer for that path has loaded, so the line actually exists to reveal.
  const pendingReveal = useStore((s) => s.pendingReveal);
  const clearReveal = useStore((s) => s.clearReveal);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !pendingReveal) return;
    if (active?.path !== pendingReveal.path) return;
    if (buffers[pendingReveal.path] === undefined) return;
    const pos = {
      lineNumber: Math.max(1, pendingReveal.line),
      column: Math.max(1, pendingReveal.column ?? 1),
    };
    ed.revealLineInCenter(pos.lineNumber);
    ed.setPosition(pos);
    ed.focus();
    clearReveal();
  }, [pendingReveal, active?.path, buffers, clearReveal]);

  // Preserve/restore scroll + cursor across tab switches.
  const prevPath = useRef<string | undefined>(undefined);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (prevPath.current && prevPath.current !== active?.path)
      viewStates.current[prevPath.current] = ed.saveViewState();
    if (active?.path && viewStates.current[active.path])
      ed.restoreViewState(viewStates.current[active.path]!);
    prevPath.current = active?.path;
  }, [active?.path]);

  if (tabs.length === 0) {
    return (
      <EmptyState
        icon={FileCode2}
        title={t("editorWelcomeTitle")}
        text={t("editorWelcomeText")}
      />
    );
  }

  const isDirty = active ? Boolean(dirty[active.path]) : false;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Tab strip */}
      <div className="flex h-[var(--h-titlebar)] shrink-0 items-stretch overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        {tabs.map((tab) => {
          const isActive = tab.path === active?.path;
          const tabDirty = tab.kind !== "diff" && dirty[tab.path];
          return (
            <div
              key={tabKey(tab)}
              className={cn(
                "group/tab relative flex shrink-0 items-center gap-1.5 border-r border-[var(--color-border)] pl-3 pr-1.5",
                "cursor-pointer text-[length:var(--fs-base)] transition-colors",
                isActive
                  ? "bg-[var(--color-bg)] text-[var(--color-text)]"
                  : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]",
              )}
              onClick={() => setActiveTab(tab.path)}
              title={tab.path}
            >
              {isActive && (
                <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--color-accent)]" />
              )}
              {tab.kind === "diff" ? (
                <GitCompare size={13} className="shrink-0 text-[var(--color-modified)]" />
              ) : (
                <FileCode2 size={13} className="shrink-0 opacity-70" />
              )}
              <span className={cn("max-w-[180px] truncate", tab.pinned && "font-medium")}>
                {tab.name}
              </span>
              <button
                className={cn(
                  "icon-btn h-5 w-5",
                  // A pin nobody can find is a feature nobody has, so it shows
                  // on hover — and stays visible once set, because the state
                  // has to be readable without hovering every tab.
                  tab.pinned ? "text-[var(--color-accent)]" : "opacity-0 group-hover/tab:opacity-100",
                )}
                title={tab.pinned ? t("editorUnpin") : t("editorPin")}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(tab.path);
                }}
              >
                <Pin size={11} />
              </button>
              {tab.kind !== "diff" && (
                <button
                  className={cn(
                    "icon-btn h-5 w-5",
                    splitPath === tab.path
                      ? "text-[var(--color-accent)]"
                      : "opacity-0 group-hover/tab:opacity-100",
                  )}
                  title={t("editorSplit")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSplitTab(tab.path);
                  }}
                >
                  <Columns size={11} />
                </button>
              )}
              <button
                className="icon-btn h-5 w-5"
                title={tabDirty ? t("editorUnsaved") : t("editorCloseTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.path);
                }}
              >
                {tabDirty ? (
                  <span className="h-2 w-2 rounded-full bg-[var(--color-accent-strong)] group-hover/tab:hidden" />
                ) : null}
                <X size={12} className={cn(tabDirty && "hidden group-hover/tab:block")} />
              </button>
            </div>
          );
        })}

        <div className="flex flex-1 items-center justify-end gap-1 px-2">
          {active?.kind !== "diff" && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void save()}
              disabled={!isDirty || saving}
              title="⌘S"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t("editorSave")}
            </button>
          )}
        </div>
      </div>

      {active && active.kind !== "diff" && (
        <Breadcrumbs
          path={active.path}
          text={buffers[active.path] ?? ""}
          line={cursorLine}
          blameOn={blameOn}
          onToggleBlame={() => setBlameOn((v) => !v)}
          onJump={(line) => {
            const ed = editorRef.current;
            if (!ed) return;
            ed.revealLineInCenter(line);
            ed.setPosition({ lineNumber: line, column: 1 });
            ed.focus();
          }}
        />
      )}

      {error && (
        <div className="alert mx-2 mt-2 items-center py-1.5 text-[length:var(--fs-xs)]">
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <button className="icon-btn h-5 w-5" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {missingServer && lspKey && !dismissedLsp.has(lspKey) && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[length:var(--fs-xs)]">
          <Info size={13} className="shrink-0 text-[var(--color-text-dim)]" />
          <span className="shrink-0 text-[var(--color-text-dim)]">
            {t("lspServerMissing", { name: missingServer.label })}
          </span>
          <code className="min-w-0 flex-1 truncate rounded-[var(--r-sm)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[var(--color-text)]">
            {missingServer.install}
          </code>
          <button
            className="icon-btn h-5 w-5 shrink-0"
            title={copiedInstall ? t("copied") : t("copy")}
            onClick={async () => {
              if (await copyText(missingServer.install)) {
                setCopiedInstall(true);
                setTimeout(() => setCopiedInstall(false), 1200);
              }
            }}
          >
            {copiedInstall ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            className="icon-btn h-5 w-5 shrink-0"
            title={t("errorDismiss")}
            onClick={() => setDismissedLsp((s) => new Set(s).add(lspKey))}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          {!monacoReady ? (
            <EditorSkeleton />
          ) : active?.kind === "diff" ? (
            <DiffView path={active.path} staged={Boolean(active.staged)} />
          ) : active && buffers[active.path] !== undefined ? (
            <CodePane
              path={active.path}
              value={buffers[active.path]}
              theme={resolvedTheme}
              prefs={prefs}
              onMount={onMount}
              onChange={(v) => {
                setBuffers((b) => ({ ...b, [active.path]: v }));
                setDirty((d) => ({ ...d, [active.path]: true }));
                lsp.didChange(active.path, v);
              }}
            />
          ) : (
            <EditorSkeleton />
          )}
        </div>

        {splitPath && splitPath !== active?.path && (
          <>
            <div className="w-px shrink-0 bg-[var(--color-border)]" />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
                <FileCode2 size={12} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate" title={splitPath}>
                  {splitPath.split("/").pop()}
                </span>
                {dirty[splitPath] && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-strong)]" />
                )}
                <button
                  className="icon-btn h-5 w-5"
                  title={t("editorCloseSplit")}
                  onClick={() => setSplitTab(undefined)}
                >
                  <X size={11} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {buffers[splitPath] !== undefined ? (
                  <CodePane
                    path={splitPath}
                    value={buffers[splitPath]}
                    theme={resolvedTheme}
                    prefs={prefs}
                    onChange={(v) => {
                      setBuffers((b) => ({ ...b, [splitPath]: v }));
                      setDirty((d) => ({ ...d, [splitPath]: true }));
                      lsp.didChange(splitPath, v);
                    }}
                  />
                ) : (
                  <EditorSkeleton />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="skel h-3" style={{ width: `${35 + ((i * 17) % 60)}%` }} />
      ))}
    </div>
  );
}


/** Where the open file sits, and what part of it the cursor is in.
 *
 *  A tab shows a filename, and half a project's filenames are `index.ts`. The
 *  full path was in the tooltip — available to someone who already suspects
 *  they have the wrong file open, by which point the trail has done its job
 *  badly.
 *
 *  The symbol half comes from the heuristic outline rather than a language
 *  server, so it is there on the first keystroke and in files whose language
 *  has no server installed. A trail that appears only once `npm install -g`
 *  has been run is a trail nobody sees.
 */
function Breadcrumbs({
  path,
  text,
  line,
  blameOn,
  onToggleBlame,
  onJump,
}: {
  path: string;
  text: string;
  line: number;
  blameOn: boolean;
  onToggleBlame: () => void;
  onJump: (line: number) => void;
}) {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const revealInFile = useStore((s) => s.revealInFile);
  const lang = useStore((s) => s.lang);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<import("../../lib/git").Commit[] | null>(null);
  void revealInFile;
  const relative = root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
  const segments = relative.split("/").filter(Boolean);

  // Re-read the structure only when the text settles, not per keystroke: the
  // scan is cheap but it is not free, and a breadcrumb that flickers while you
  // type is worse than one that lags a moment behind.
  const symbols = useMemo(() => outlineOf(path, text), [path, text]);
  const trail = useMemo(() => trailAt(symbols, line), [symbols, line]);

  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="breadcrumbs"
      className="relative flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3 py-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]"
    >
      {segments.map((segment, i) => (
        <span key={`p-${i}`} className="flex shrink-0 items-center gap-1" title={path}>
          {i > 0 && <span className="opacity-50">/</span>}
          <span className={i === segments.length - 1 ? "text-[var(--color-text-dim)]" : undefined}>
            {segment}
          </span>
        </span>
      ))}

      {trail.map((symbol, i) => (
        <button
          key={`s-${symbol.line}-${i}`}
          onClick={() => onJump(symbol.line)}
          className="flex shrink-0 items-center gap-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          title={`${symbol.kind} · ${symbol.name}`}
        >
          <span className="opacity-50">›</span>
          {symbol.name}
        </button>
      ))}

      <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <button
          onClick={onToggleBlame}
          className={cn(
            "text-[length:var(--fs-2xs)]",
            blameOn ? "text-[var(--color-accent)]" : "text-[var(--color-text-mute)] hover:text-[var(--color-text)]",
          )}
          title={t("gitBlameToggle")}
        >
          blame
        </button>
        <button
          onClick={() => {
            if (history) {
              setHistory(null);
              return;
            }
            const rel = root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
            if (root) void fileHistory(root, rel).then(setHistory);
          }}
          className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)] hover:text-[var(--color-text)]"
          title={t("gitHistoryToggle")}
        >
          history
        </button>
        {symbols.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[var(--color-text-mute)] hover:text-[var(--color-text)]"
            title={t("editorOutline")}
            aria-expanded={open}
          >
            ⌄
          </button>
        )}
      </span>

      {history && (
        <div className="absolute right-2 top-full z-20 max-h-80 w-96 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
          <div className="section-label px-3">{t("gitFileHistory")}</div>
          {history.length === 0 && (
            <p className="px-3 py-2 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
              {t("gitNoHistory")}
            </p>
          )}
          {history.map((c) => (
            <div key={c.sha} className="px-3 py-1">
              <div className="flex items-baseline gap-2">
                <code className="shrink-0 font-mono text-[length:var(--fs-2xs)] text-[var(--color-accent)]">
                  {c.shortSha}
                </code>
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-xs)]">
                  {c.subject}
                </span>
              </div>
              <div className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                {c.author} · {relativeTime(c.time, lang === "ru" || lang === "es" ? lang : "en")}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute right-2 top-full z-20 max-h-72 w-72 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
          {symbols.map((symbol, i) => (
            <button
              key={`o-${symbol.line}-${i}`}
              onClick={() => {
                onJump(symbol.line);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[var(--color-surface-2)]"
              style={{ paddingLeft: 8 + Math.min(symbol.level, 4) * 12 }}
            >
              <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
                {symbol.name}
              </span>
              <span className="shrink-0 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                {symbol.line}
              </span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

/** One Monaco editor, configured the way this app configures them.
 *
 *  Extracted so the split pane is the same editor as the main one rather than
 *  a cut-down viewer: a second file you can look at but not fix is a worse
 *  answer than no split at all.
 */
function CodePane({
  path,
  value,
  theme,
  prefs,
  onMount,
  onChange,
}: {
  path: string;
  value: string;
  theme: string;
  prefs: { editorFontSize: number; editorMinimap: boolean; editorWordWrap: boolean };
  onMount?: OnMount;
  onChange: (value: string) => void;
}) {
  return (
    <Editor
      path={path}
      language={languageForPath(path)}
      value={value}
      theme={monacoThemeFor(theme as never)}
      onMount={onMount}
      onChange={(v) => onChange(v ?? "")}
      loading={<EditorSkeleton />}
      options={{
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: prefs.editorFontSize,
        lineHeight: 1.6,
        glyphMargin: true,
        minimap: { enabled: prefs.editorMinimap, renderCharacters: false },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        renderLineHighlight: "all",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        // Render hover/suggestion/context-menu widgets over the whole window
        // instead of clipping them to the editor — otherwise a narrow pane
        // cuts the hover tooltip in half, which a split makes routine.
        fixedOverflowWidgets: true,
        padding: { top: 12, bottom: 12 },
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
        tabSize: 2,
        wordWrap: prefs.editorWordWrap ? "on" : "off",
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      }}
    />
  );
}
