import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Loader2 } from "../icons";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { monacoThemeFor, languageForPath } from "../../lib/monaco";
import { useResolvedTheme } from "../../lib/useTheme";

/** A real side-by-side diff, the same widget VS Code uses. The left side is the
 *  committed content (HEAD or the index), the right side is what's on disk. */
export function DiffView({ path, staged }: { path: string; staged: boolean }) {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const resolvedTheme = useResolvedTheme();
  const [pair, setPair] = useState<{ original: string; modified: string } | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;

    void (async () => {
      // git wants a repo-relative path; the panel may hand us an absolute one.
      const rel = path.startsWith(root) ? path.slice(root.length + 1) : path;

      // Left: the version we are comparing against. `git show` fails for files
      // that are new to the repo — an empty original is the correct baseline.
      const originalRef = staged ? "HEAD" : ":0";
      const [orig, mod] = await Promise.all([
        api
          .gitExec(root, ["show", `${originalRef}:${rel}`])
          .then((r) => (r.code === 0 ? r.stdout : ""))
          .catch(() => ""),
        staged
          ? // Staged view compares HEAD against the index, not the worktree.
            api
              .gitExec(root, ["show", `:0:${rel}`])
              .then((r) => (r.code === 0 ? r.stdout : ""))
              .catch(() => "")
          : api.editorReadFile(`${root}/${rel}`).catch(() => ""),
      ]);

      if (cancelled) return;
      if (orig === mod) {
        setEmpty(true);
        setPair(null);
      } else {
        setEmpty(false);
        setPair({ original: orig, modified: mod });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [root, path, staged]);

  if (empty)
    return (
      <div className="flex h-full items-center justify-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
        {t("gitNoDiff")}
      </div>
    );

  if (!pair)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
        <Loader2 size={15} className="animate-spin" /> {t("loading")}
      </div>
    );

  return (
    <DiffEditor
      original={pair.original}
      modified={pair.modified}
      language={languageForPath(path)}
      theme={monacoThemeFor(resolvedTheme)}
      options={{
        readOnly: true,
        renderSideBySide: true,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12.5,
        lineHeight: 1.6,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderOverviewRuler: false,
      }}
    />
  );
}
