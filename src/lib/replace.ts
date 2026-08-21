import { api } from "./api";

/* ==========================================================================
   FIND AND REPLACE ACROSS THE PROJECT

   Deliberately literal and case-sensitive, and deliberately two-step.

   The ranked index that powers the search panel matches *words*, which is
   right for "where does this live" and wrong for replacing: it cannot tell you
   how many exact occurrences a file holds, and replacing what it returns would
   edit things the user never saw. So the candidate files come from a grep and
   every occurrence is then counted in the file itself, exactly as typed.

   Nothing is written until the user has seen the file list with counts. A
   project-wide replace is a destructive act; it gets the same respect as one.
   ========================================================================== */

export interface ReplaceCandidate {
  file: string;
  /** Exact, case-sensitive occurrences of the needle in this file. */
  count: number;
  /** First matching line, for a glance before committing. */
  preview: string;
  previewLine: number;
}

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
};

/** Files that literally contain the needle, with how many times. */
export async function findExact(
  root: string,
  needle: string,
): Promise<ReplaceCandidate[]> {
  if (!needle.trim()) return [];
  // grep narrows the search to plausible files (it is case-insensitive and
  // skips node_modules, .git, build output); the exact count is done here.
  const hits = await api.toolGrep(needle, root);
  const files = [...new Set(hits.map((h) => h.file))];

  const out: ReplaceCandidate[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await api.editorReadFile(file);
    } catch {
      continue; // binary or unreadable — never a replace target
    }
    const count = countOccurrences(content, needle);
    if (!count) continue; // matched only case-insensitively

    const lines = content.split("\n");
    const idx = lines.findIndex((l) => l.includes(needle));
    out.push({
      file,
      count,
      preview: (lines[idx] ?? "").trim().slice(0, 200),
      previewLine: idx + 1,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface ReplaceResult {
  files: number;
  occurrences: number;
  failed: string[];
}

/** Rewrite the chosen files. Only the exact string is touched. */
export async function replaceIn(
  files: string[],
  needle: string,
  replacement: string,
): Promise<ReplaceResult> {
  const result: ReplaceResult = { files: 0, occurrences: 0, failed: [] };
  if (!needle) return result;

  for (const file of files) {
    try {
      const content = await api.editorReadFile(file);
      const count = countOccurrences(content, needle);
      if (!count) continue;
      await api.toolWriteFile(file, content.split(needle).join(replacement));
      result.files += 1;
      result.occurrences += count;
    } catch (e) {
      // Report which files were left alone instead of claiming a clean run.
      result.failed.push(`${file}: ${String(e).slice(0, 80)}`);
    }
  }
  return result;
}
