import { useRef, useState } from "react";
import { Search, Loader2, FileCode2, FolderGit2, Replace } from "../icons";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { EmptyState } from "../ui/EmptyState";
import { Hint } from "../ui/Hint";
import { cn } from "../../lib/cn";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { findExact, replaceIn, type ReplaceCandidate } from "../../lib/replace";
import type { SearchHit, SearchOptions } from "../../lib/api";

/** Text search over the project, offline and with no provider involved.
 *
 *  It used to run off the ranked BM25 index, which matches words and answers
 *  "where does this live". That is the wrong question for a search panel and
 *  the wrong basis for replace, which needs the exact occurrences. Both now use
 *  the one text engine, so the list shown before a replace is the list that
 *  gets replaced. The ranked index is still what the agent searches with.
 */
export function SearchPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const openTab = useStore((s) => s.openTab);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How to interpret the query. Persisted nowhere: a regex left on from
   *  yesterday turns tomorrow's plain search into a confusing no-match. */
  const [mode, setMode] = useState<SearchOptions>({});
  /** Why the last run stopped short, if it did. */
  const [partial, setPartial] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The id of the run in flight, so Stop cancels this search and not the
   *  next one the user has already started typing. */
  const running = useRef<string | null>(null);

  // Replace is a separate mode on the same query: ranked search answers "where
  // does this live", replace needs exact occurrences, and mixing the two would
  // rewrite things the user never saw.
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [candidates, setCandidates] = useState<ReplaceCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  const scanForReplace = async () => {
    const needle = query;
    if (!needle.trim() || !root) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const scan = await findExact(root, needle, mode);
      setCandidates(scan.candidates);
      setChosen(new Set(scan.candidates.map((c) => c.file)));
      if (scan.truncated || scan.timedOut) setPartial(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyReplace = async () => {
    if (!candidates) return;
    setBusy(true);
    try {
      const r = await replaceIn([...chosen], query, replacement);
      setDone(t("replaceDone", { files: String(r.files), count: String(r.occurrences) }));
      if (r.failed.length) setError(r.failed.join("\n"));
      setCandidates(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    const q = query.trim();
    if (!q || !root) return;
    // A new search supersedes the one before it: leaving the old one running
    // wastes the machine and its results would arrive after the new ones.
    if (running.current) void api.searchCancel(running.current);
    const id = `search-${Date.now()}`;
    running.current = id;

    setBusy(true);
    setError(null);
    setPartial(false);
    setNote(null);
    try {
      const found = await api.searchText(root, q, { ...mode, maxResults: 500 }, id);
      if (running.current !== id) return; // superseded while we waited
      setHits(found.hits);
      setPartial(found.truncated || found.timedOut);
      setNote(
        found.cancelled
          ? t("searchStopped")
          : found.timedOut
            ? t("searchTimedOut").replace("{files}", String(found.filesScanned))
            : found.truncated
              ? t("searchTruncated").replace("{count}", String(found.hits.length))
              : null,
      );
    } catch (e) {
      // A bad regex is the common case here, and the message explains it.
      setError(String(e).replace(/^Error:\s*/, ""));
      setHits([]);
    } finally {
      if (running.current === id) running.current = null;
      setBusy(false);
    }
  };

  const stop = () => {
    if (running.current) void api.searchCancel(running.current);
  };

  const toggle = (key: keyof SearchOptions) => () =>
    setMode((m) => ({ ...m, [key]: !m[key] }));

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
        <div className="flex items-center gap-1 px-1 pt-1.5">
          {(
            [
              ["caseSensitive", "Aa", "searchCaseHint"],
              ["wholeWord", "ab|", "searchWordHint"],
              ["regex", ".*", "searchRegexHint"],
            ] as const
          ).map(([key, glyph, hint]) => (
            <Hint key={key} text={t(hint)}>
              <button
                onClick={toggle(key)}
                aria-pressed={!!mode[key]}
                className={cn(
                  "rounded-[var(--r-sm)] px-1.5 py-0.5 font-mono text-[length:var(--fs-2xs)]",
                  mode[key]
                    ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
                    : "text-[var(--color-text-mute)] hover:text-[var(--color-text)]",
                )}
              >
                {glyph}
              </button>
            </Hint>
          ))}
          {busy && (
            <button
              onClick={stop}
              className="ml-1 text-[length:var(--fs-xs)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              {t("searchStop")}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-1 pt-1">
          <p
            className={cn(
              "flex-1 text-[length:var(--fs-xs)]",
              partial ? "text-[var(--color-warning,var(--color-text-dim))]" : "text-[var(--color-text-mute)]",
            )}
          >
            {note ?? done ?? (hits ? `${hits.length} ${t("searchResults")}` : t("searchHint"))}
          </p>
          <button
            className="text-[length:var(--fs-xs)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            onClick={() => {
              setReplaceOpen((v) => !v);
              setCandidates(null);
              setDone(null);
            }}
          >
            {replaceOpen ? t("cancel") : t("replaceToggle")}
          </button>
        </div>

        {replaceOpen && (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 focus-within:border-[var(--color-accent)]">
              <Replace size={13} className="shrink-0 text-[var(--color-text-mute)]" />
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("replacePlaceholder")}
                className="h-8 w-full bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
              />
            </div>
            <p className="text-[length:var(--fs-2xs)] leading-relaxed text-[var(--color-text-mute)]">
              {t("replaceNote")}
            </p>
            <button
              className="btn btn-secondary btn-sm w-full"
              disabled={busy || !query.trim()}
              onClick={() => void scanForReplace()}
            >
              {t("replaceScan")}
            </button>
          </div>
        )}
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

        {!busy && candidates && (
          <div className="pb-2">
            {candidates.length === 0 ? (
              <p className="px-2 py-6 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                {t("searchNoResults")}
              </p>
            ) : (
              <>
                {candidates.map((c) => (
                  <label
                    key={c.file}
                    className="mb-1 flex w-full cursor-pointer items-start gap-2 rounded-[var(--r-md)] px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
                    title={c.file}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={chosen.has(c.file)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(c.file);
                        else next.delete(c.file);
                        setChosen(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[length:var(--fs-base)]">
                          {c.file.replace(root + "/", "")}
                        </span>
                        <span className="badge ml-auto shrink-0">{c.count}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
                        {c.preview}
                      </span>
                    </span>
                  </label>
                ))}
                <button
                  className="btn btn-danger btn-sm mt-1 w-full"
                  disabled={busy || chosen.size === 0}
                  onClick={() => void applyReplace()}
                >
                  {t("replaceApply", {
                    files: String(chosen.size),
                    count: String(
                      candidates
                        .filter((c) => chosen.has(c.file))
                        .reduce((n, c) => n + c.count, 0),
                    ),
                  })}
                </button>
              </>
            )}
          </div>
        )}

        {!busy &&
          !candidates &&
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
                <HitText hit={h} query={query} />
              </p>
            </button>
          ))}
      </div>
    </div>
  );
}


/** The matching line with the match itself picked out.
 *
 *  The engine reports where the match starts, so the reader does not have to
 *  scan the line again to find what they searched for. Falls back to plain
 *  text when the column does not line up — a wrong highlight is worse than
 *  none.
 */
function HitText({ hit, query }: { hit: SearchHit; query: string }) {
  const end = hit.column + query.length;
  if (hit.column < 0 || end > hit.text.length) return <>{hit.text}</>;
  return (
    <>
      {hit.text.slice(0, hit.column)}
      <mark className="bg-[var(--color-accent)]/25 text-[var(--color-text)]">
        {hit.text.slice(hit.column, end)}
      </mark>
      {hit.text.slice(end)}
    </>
  );
}
