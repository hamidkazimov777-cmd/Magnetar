import { api } from "./api";
import { useStore } from "./store";

/* ==========================================================================
   @-mentions and /-commands for the composer.
   ========================================================================== */

/** A slash command offered when the message starts with "/". */
export interface SlashCommand {
  id: string;
  /** What gets inserted; the agent path recognises these prefixes. */
  insert: string;
  /** i18n key for the human description. */
  descKey: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "/cto", insert: "/cto", descKey: "slashCto" },
  { id: "/team", insert: "/team ", descKey: "slashTeam" },
  { id: "/explain", insert: "/explain ", descKey: "slashExplain" },
  { id: "/fix", insert: "/fix ", descKey: "slashFix" },
  { id: "/test", insert: "/test ", descKey: "slashTest" },
  { id: "/review", insert: "/review ", descKey: "slashReview" },
];

/** Plain-language expansions for the commands that are just prompts. */
export const SLASH_PROMPTS: Record<string, string> = {
  "/explain":
    "Explain how this works, using the project files. Be concrete and reference real paths.",
  "/fix": "Find and fix this problem in the project. Verify the fix when you can.",
  "/test": "Write or update tests covering this, and run them if a test command exists.",
  "/review":
    "Review the current changes for correctness, edge cases and clarity. Be specific.",
};

/** Expand a leading slash command into the instruction the model receives. */
export function expandSlash(text: string): string {
  const m = text.match(/^(\/[a-z]+)\s*([\s\S]*)$/i);
  if (!m) return text;
  const prompt = SLASH_PROMPTS[m[1].toLowerCase()];
  if (!prompt) return text;
  return m[2].trim() ? `${prompt}\n\n${m[2].trim()}` : prompt;
}

/* -------------------------------------------------------------------------- */

let cache: { root: string; files: string[] } | null = null;

/** Project files for the `@` picker, cached per workspace root. */
export async function projectFiles(force = false): Promise<string[]> {
  const root = useStore.getState().workspaceRoot;
  if (!root) return [];
  if (!force && cache?.root === root) return cache.files;
  try {
    const files = await api.listProjectFiles(root);
    cache = { root, files };
    return files;
  } catch {
    return [];
  }
}

export function invalidateProjectFiles() {
  cache = null;
}

/** Subsequence match, the way editors score fuzzy file pickers: every query
 *  character must appear in order; matches on the basename rank higher. */
export function rankFiles(files: string[], query: string, limit = 30): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const lower = path.toLowerCase();
    const base = lower.split("/").pop() ?? lower;

    let score: number;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else if (isSubsequence(q, base)) score = 3;
    else if (isSubsequence(q, lower)) score = 4;
    else continue;

    // Shorter paths win ties — they are usually the ones people mean.
    scored.push({ path, score: score * 1000 + path.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.path);
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/* -------------------------------------------------------------------------- */

/** Repo-relative paths mentioned with `@` in a message. */
export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  // A mention runs until whitespace; paths with spaces are not supported.
  for (const m of text.matchAll(/@([^\s@]+)/g)) out.add(m[1]);
  return [...out];
}

const MENTION_CAP = 24_000;

/** Read mentioned files and format them as a context block for the model.
 *  Returns "" when nothing was mentioned, so callers can append unconditionally. */
export async function buildMentionContext(text: string): Promise<string> {
  const root = useStore.getState().workspaceRoot;
  const paths = extractMentions(text);
  if (!root || paths.length === 0) return "";

  const parts: string[] = [];
  let budget = MENTION_CAP;

  for (const rel of paths) {
    if (budget <= 0) break;
    const abs = rel.startsWith("/") ? rel : `${root}/${rel}`;
    try {
      const content = await api.editorReadFile(abs);
      const slice = content.slice(0, budget);
      budget -= slice.length;
      parts.push(
        `<file path="${rel}">\n${slice}${
          slice.length < content.length ? "\n… (truncated)" : ""
        }\n</file>`,
      );
    } catch {
      // A mention that is not a real file is just text — skip it silently.
    }
  }

  if (parts.length === 0) return "";
  return `\n\n## Files the user attached with @\n${parts.join("\n\n")}`;
}
