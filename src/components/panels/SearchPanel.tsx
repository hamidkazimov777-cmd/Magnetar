import { useState } from "react";
import { Search, Loader2, FileCode2, FolderGit2 } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { EmptyState } from "../ui/EmptyState";
import { pickWorkspaceFolder } from "./ExplorerPanel";

interface Hit {
  file: string;
  score: number;
  snippet: string;
  line: number;
}

/** Ranked project search backed by the local BM25 index (offline, no provider).
 *  Clicking a hit opens the file in the editor. */
export function SearchPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const openTab = useStore((s) => s.openTab);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q || !root) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await api.indexSearch(root, q, 40));
    } catch (e) {
      setError(String(e));
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  if (!root) {
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("searchTitle")}</span>
        </header>
        <EmptyState
          icon={FolderGit2}
          title={t("searchNoFolder")}
          action={{
            label: t("explorerOpenFolder"),
            onClick: () => void pickWorkspaceFolder(),
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">{t("searchTitle")}</span>
      </header>

      <div className="px-2 pb-1 pt-2">
        <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 focus-within:border-[var(--color-accent)]">
          {busy ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />
          ) : (
            <Search size={13} className="shrink-0 text-[var(--color-text-mute)]" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
            placeholder={t("searchPlaceholder")}
            className="h-8 w-full bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
          />
        </div>
        <p className="px-1 pt-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {hits ? `${hits.length} ${t("searchResults")}` : t("searchHint")}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {error && <div className="alert my-2">{error}</div>}

        {busy && (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1">
                <div className="skel h-3 w-1/2" />
                <div className="skel h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {!busy && hits?.length === 0 && !error && (
          <p className="px-2 py-6 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
            {t("searchNoResults")}
          </p>
        )}

        {!busy &&
          hits?.map((h, i) => (
            <button
              key={`${h.file}:${h.line}:${i}`}
              onClick={() =>
                openTab({
                  path: h.file,
                  name: h.file.split(/[/\\]/).pop() || h.file,
                  kind: "file",
                })
              }
              className="mb-1 w-full rounded-[var(--r-md)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
              title={h.file}
            >
              <div className="flex items-center gap-1.5">
                <FileCode2 size={13} className="shrink-0 text-[var(--color-accent)]" />
                <span className="truncate text-[length:var(--fs-base)] text-[var(--color-text)]">
                  {h.file.replace(root + "/", "")}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                  :{h.line}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 pl-[19px] font-mono text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-dim)]">
                {h.snippet.trim()}
              </p>
            </button>
          ))}
      </div>
    </div>
  );
}
