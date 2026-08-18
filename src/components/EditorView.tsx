import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  Save,
  FolderGit2,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { analyzeFolderIntoMemory } from "../lib/memory";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";
import { Brain, Loader2 } from "lucide-react";

function langFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: true })];
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "rs":
      return [rust()];
    case "py":
      return [python()];
    case "md":
    case "markdown":
      return [markdown()];
    case "html":
    case "htm":
      return [html()];
    case "css":
      return [css()];
    default:
      return [];
  }
}

interface OpenFile {
  path: string;
  name: string;
}

function TreeNode({
  path,
  name,
  isDir,
  depth,
  activePath,
  onOpen,
}: {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  activePath?: string;
  onOpen: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<
    { name: string; isDir: boolean }[] | null
  >(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!isDir) {
      onOpen(path, name);
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const entries = await api.toolListDir(path);
        setChildren(entries.filter((e) => !e.name.startsWith(".") || e.name === ".env"));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div>
      <button
        onClick={toggle}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={cn(
          "flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-[13px] hover:bg-[var(--color-surface-2)]",
          activePath === path && !isDir
            ? "bg-[var(--color-surface-2)] text-[var(--color-accent-strong)]"
            : "text-[var(--color-text)]",
        )}
      >
        {isDir ? (
          <>
            {expanded ? (
              <ChevronDown size={13} className="shrink-0 text-[var(--color-text-dim)]" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-[var(--color-text-dim)]" />
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
            <FileIcon size={14} className="shrink-0 text-[var(--color-text-dim)]" />
          </>
        )}
        <span className="truncate">{name}</span>
      </button>
      {expanded && children && (
        <div>
          {loading && (
            <div
              style={{ paddingLeft: 20 + depth * 12 }}
              className="py-1 text-xs text-[var(--color-text-dim)]"
            >
              …
            </div>
          )}
          {children.map((c) => (
            <TreeNode
              key={c.name}
              path={`${path}/${c.name}`}
              name={c.name}
              isDir={c.isDir}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function EditorView() {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const setWorkspaceRoot = useStore((s) => s.setWorkspaceRoot);

  const [file, setFile] = useState<OpenFile | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rootKey, setRootKey] = useState(0); // force tree remount on root change
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<string | null>(null);

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

  const rootName = useMemo(
    () => workspaceRoot?.split(/[/\\]/).pop() || workspaceRoot,
    [workspaceRoot],
  );

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setWorkspaceRoot(selected);
      setRootKey((k) => k + 1);
      setFile(null);
      setAnalyzed(null);
      // App analyzes the folder into long-term memory (best-effort, cheap model).
      setAnalyzing(true);
      analyzeFolderIntoMemory(selected)
        .then((p) => setAnalyzed(p?.name ?? null))
        .finally(() => setAnalyzing(false));
    }
  };

  const openFile = async (path: string, name: string) => {
    try {
      const text = await api.editorReadFile(path);
      setFile({ path, name });
      setContent(text);
      setDirty(false);
    } catch (e) {
      setFile({ path, name });
      setContent(`// Cannot open file: ${String(e)}`);
      setDirty(false);
    }
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await api.toolWriteFile(file.path, content);
      setDirty(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, file, content]);

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={pickFolder}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <FolderGit2 size={15} />
            {workspaceRoot ? rootName : t("editorOpenFolder")}
          </button>
          {file && (
            <span className="text-[var(--color-text-dim)]">
              {file.name}
              {dirty && <span className="ml-1 text-[var(--color-accent-strong)]">●</span>}
            </span>
          )}
          {workspaceRoot && (
            <button
              onClick={analyze}
              disabled={analyzing}
              title={t("memAnalyzeHint")}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-60"
            >
              {analyzing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Brain size={13} className="text-[var(--color-accent-strong)]" />
              )}
              {analyzing
                ? t("memAnalyzing")
                : analyzed
                  ? `${t("memInMemory")}: ${analyzed}`
                  : t("memAnalyze")}
            </button>
          )}
        </div>
        {file && (
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent-fg)] disabled:opacity-40"
          >
            <Save size={15} />
            {t("editorSave")}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* File tree */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-2">
          {workspaceRoot ? (
            <TreeNode
              key={rootKey}
              path={workspaceRoot}
              name={rootName || workspaceRoot}
              isDir
              depth={0}
              activePath={file?.path}
              onOpen={openFile}
            />
          ) : (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              {t("editorNoFolder")}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {file ? (
            <CodeMirror
              value={content}
              theme={oneDark}
              height="100%"
              extensions={langFor(file.path)}
              onChange={(v) => {
                setContent(v);
                setDirty(true);
              }}
              style={{ height: "100%", fontSize: 13 }}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-[var(--color-text-dim)]">
              {t("editorPickFile")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
