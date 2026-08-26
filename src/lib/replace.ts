import { api, type SearchOptions } from "./api";

/* ==========================================================================
   FIND AND REPLACE ACROSS THE PROJECT

   Deliberately two-step, and deliberately the same engine as the search panel.

   It used to run off the ranked index, which matches *words* — right for "where
   does this live", wrong for replacing, because it cannot say how many exact
   occurrences a file holds and replacing what it returns would edit things the
   user never saw. Now both use one text search, so the list shown before the
   replace is the list that gets replaced.

   Nothing is written until the user has seen the files and the counts. A
   project-wide replace is a destructive act; it gets the same respect as one.
   ========================================================================== */

export interface ReplaceCandidate {
  file: string;
  /** Occurrences in this file, counted with the same matcher the search used. */
  count: number;
  /** First matching line, for a glance before committing. */
  preview: string;
  previewLine: number;
}

export interface ReplaceScan {
  candidates: ReplaceCandidate[];
  /** Carried through from the search: the user must know the list is partial
   *  before replacing from it. */
  truncated: boolean;
  timedOut: boolean;
}

/** Build the matcher the preview and the write both use, so what was counted
 *  is what gets changed. */
export function buildRegExp(needle: string, opts: SearchOptions): RegExp {
  const body = opts.regex ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wrapped = opts.wholeWord ? `\\b(?:${body})\\b` : body;
  return new RegExp(wrapped, opts.caseSensitive ? "g" : "gi");
}

/** Count without letting a zero-width match spin forever.
 *
 *  A pattern like `x*` matches the empty string at every position; the naive
 *  loop over `exec` never advances past it and hangs the app.
 */
export function countMatches(haystack: string, re: RegExp): number {
  const scan = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let count = 0;
  let guard = 0;
  for (;;) {
    const m = scan.exec(haystack);
    if (!m) return count;
    count += 1;
    if (m.index === scan.lastIndex) scan.lastIndex += 1;
    if (++guard > 1_000_000) return count;
  }
}

/** Files that contain the pattern, with how many times. */
export async function findExact(
  root: string,
  needle: string,
  opts: SearchOptions = {},
): Promise<ReplaceScan> {
  if (!needle.trim()) return { candidates: [], truncated: false, timedOut: false };

  const found = await api.searchText(
    root,
    needle,
    // A generous budget: this list is about to be acted on, so a quietly
    // shortened one is worse here than anywhere else.
    { ...opts, maxResults: 2000 },
    `replace-${Date.now()}`,
  );

  const re = buildRegExp(needle, opts);
  const byFile = new Map<string, ReplaceCandidate>();
  for (const hit of found.hits) {
    const existing = byFile.get(hit.file);
    if (existing) continue;
    byFile.set(hit.file, {
      file: hit.file,
      count: 0,
      preview: hit.text,
      previewLine: hit.line,
    });
  }

  const candidates: ReplaceCandidate[] = [];
  for (const candidate of byFile.values()) {
    let content: string;
    try {
      content = await api.editorReadFile(candidate.file);
    } catch {
      continue; // unreadable — never a replace target
    }
    const count = countMatches(content, re);
    if (!count) continue;
    candidates.push({ ...candidate, count });
  }

  return { candidates, truncated: found.truncated, timedOut: found.timedOut };
}

export interface ReplaceResult {
  files: number;
  occurrences: number;
  failed: string[];
}

/** Apply the replacement to the chosen files. */
export async function replaceIn(
  files: string[],
  needle: string,
  replacement: string,
  opts: SearchOptions = {},
): Promise<ReplaceResult> {
  const re = buildRegExp(needle, opts);
  const out: ReplaceResult = { files: 0, occurrences: 0, failed: [] };

  for (const file of files) {
    try {
      const content = await api.editorReadFile(file);
      const count = countMatches(content, re);
      if (!count) continue;
      const pattern = new RegExp(re.source, re.flags);
      // Only a regex replacement gets $1 and friends. A literal one goes
      // through a function so a dollar sign the user typed stays a dollar sign
      // instead of being read as a capture reference.
      const next = opts.regex
        ? content.replace(pattern, replacement)
        : content.replace(pattern, () => replacement);
      if (next === content) continue;
      await api.toolWriteFile(file, next);
      out.files += 1;
      out.occurrences += count;
    } catch (e) {
      out.failed.push(`${file}: ${String(e).slice(0, 120)}`);
    }
  }
  return out;
}
