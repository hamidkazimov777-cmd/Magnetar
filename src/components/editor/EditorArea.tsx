import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { X, Save, FileCode2, GitCompare, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { useStore, type EditorTab } from "../../lib/store";
import { syncCheckMarkers } from "../../lib/markers";
import * as lsp from "../../lib/lspManager";
import { registerLspProviders } from "../../lib/lspEditor";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { DiffView } from "./DiffView";
import type * as monaco from "monaco-editor";
import { monacoThemeFor, languageForPath, loadMonaco } from "../../lib/monaco";
import { useResolvedTheme } from "../../lib/useTheme";

const tabKey = (tab: EditorTab) =>
  `${tab.kind === "diff" ? "diff" : "file"}:${tab.staged ? "s:" : ""}${tab.path}`;

/** The center of the workspace: a VS Code-style tab strip over Monaco — the
 *  same editor engine VS Code uses, bundled locally so it works offline. */
export function EditorArea() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const activeTabPath = useStore((s) => s.activeTabPath);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const prefs = useStore((s) => s.prefs);
  const resolvedTheme = useResolvedTheme();

  const active = tabs.find((x) => x.path === activeTabPath) ?? tabs[0];

  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [monacoReady, setMonacoReady] = useState(false);
  const loadedRef = useRef<Set<string>>(new Set());
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
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

  // Load the active file's content once per path.
  useEffect(() => {
    if (!active || active.kind === "diff") return;
    if (loadedRef.current.has(active.path)) return;
    loadedRef.current.add(active.path);
    let cancelled = false;
    void api
      .editorReadFile(active.path)
      .then((text) => {
        if (cancelled) return;
        setBuffers((b) => ({ ...b, [active.path]: text }));
        // Hand the freshly loaded document to its language server, if one is
        // installed. Best-effort: never let this disturb the editor.
        void lsp.didOpen(active.path, text).catch(() => {});
      })
      .catch((e) => {
        if (cancelled) return;
        // A directory is not an editor error worth a red banner across the
        // whole editor — just close the tab that should never have opened.
        if (/is a directory/i.test(String(e))) {
          loadedRef.current.delete(active.path);
          closeTab(active.path);
          return;
        }
        setError(`${t("editorOpenError")}: ${String(e)}`);
        setBuffers((b) => ({ ...b, [active.path]: "" }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.path, active?.kind]);

  // Forget buffers for tabs that were closed, so reopening re-reads from disk.
  useEffect(() => {
    const open = new Set(tabs.filter((x) => x.kind !== "diff").map((x) => x.path));
    for (const p of Array.from(loadedRef.current))
      if (!open.has(p)) {
        loadedRef.current.delete(p);
        delete viewStates.current[p];
        lsp.didClose(p);
      }
  }, [tabs]);

  const save = useCallback(async () => {
    if (!active || active.kind === "diff") return;
    const content = buffers[active.path];
    if (content === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await api.toolWriteFile(active.path, content);
      setDirty((d) => ({ ...d, [active.path]: false }));
      refreshExplorer();
    } catch (e) {
      setError(`${t("editorSaveError")}: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [active, buffers, refreshExplorer, t]);

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
    // Monaco owns ⌘S inside the editor; wire it to the same save path.
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => void save(),
    );
    // Wire language-server features (hover, …) to the editor. Idempotent.
    registerLspProviders(monacoInstance);
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
              <span className="max-w-[180px] truncate">{tab.name}</span>
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

      <div className="min-h-0 flex-1 overflow-hidden">
        {!monacoReady ? (
          <EditorSkeleton />
        ) : active?.kind === "diff" ? (
          <DiffView path={active.path} staged={Boolean(active.staged)} />
        ) : active && buffers[active.path] !== undefined ? (
          <Editor
            path={active.path}
            language={languageForPath(active.path)}
            value={buffers[active.path]}
            theme={monacoThemeFor(resolvedTheme)}
            onMount={onMount}
            onChange={(v) => {
              setBuffers((b) => ({ ...b, [active.path]: v ?? "" }));
              setDirty((d) => ({ ...d, [active.path]: true }));
              lsp.didChange(active.path, v ?? "");
            }}
            loading={<EditorSkeleton />}
            options={{
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: prefs.editorFontSize,
              lineHeight: 1.6,
              minimap: { enabled: prefs.editorMinimap, renderCharacters: false },
              smoothScrolling: true,
              cursorBlinking: "smooth",
              renderLineHighlight: "all",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
              bracketPairColorization: { enabled: true },
              guides: { indentation: true, bracketPairs: true },
              tabSize: 2,
              wordWrap: prefs.editorWordWrap ? "on" : "off",
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            }}
          />
        ) : (
          <EditorSkeleton />
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
