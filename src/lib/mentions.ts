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
  { id: "/explain", insert: "/explain ", descKey: "slashExplain" },
  { id: "/fix", insert: "/fix ", descKey: "slashFix" },
  { id: "/test", insert: "/test ", descKey: "slashTest" },
  { id: "/review", insert: "/review ", descKey: "slashReview" },
  { id: "/security", insert: "/security", descKey: "slashSecurity" },
  { id: "/simplify", insert: "/simplify ", descKey: "slashSimplify" },
  { id: "/docs", insert: "/docs ", descKey: "slashDocs" },
  { id: "/commit", insert: "/commit", descKey: "slashCommit" },
  { id: "/btw", insert: "/btw ", descKey: "slashBtw" },
  // One prompt command for any model — the target is named in the text
  // (`/prompt <model> <request>`); expandSlash reads it, so there is no need to
  // enumerate models.
  { id: "/prompt", insert: "/prompt ", descKey: "slashPromt" },
];

/** Plain-language expansions for the commands that are just prompts. */
export const SLASH_PROMPTS: Record<string, string> = {
  "/explain":
    "Explain how this works, using the project files. Be concrete and reference real paths.",
  "/fix": "Find and fix this problem in the project. Verify the fix when you can.",
  "/test": "Write or update tests covering this, and run them if a test command exists.",
  "/review":
    "Review the current changes for correctness, edge cases and clarity. Be specific.",
  "/security":
    "Review the current changes for security issues — injection, secret leakage, unsafe shell/network/path handling, missing authorization. Report concrete findings with file:line and a fix for each; do not change code unless asked.",
  "/simplify":
    "Review the changed code for reuse, simplification, dead code and needless complexity, then apply safe cleanups. Quality only — do not hunt for bugs.",
  "/docs":
    "Write or update the documentation (README or docs/) so it matches the current code. Be accurate and concise; do not invent behaviour that is not there.",
  "/commit":
    "Review the staged and unstaged changes, write one clear conventional-commit message describing them, and commit. If on the default branch, create a branch first.",
  "/btw":
    "This is a quick side question, not a task. Answer it using the project where relevant, and do NOT change anything — read and explain only, no writing, editing, or mutating commands.",
};

/** Expand a leading slash command into the instruction the model receives.
 *  Command names may be Latin or Cyrillic. */
export function expandSlash(text: string): string {
  // `/prompt <model> <request>` — the model is the first token, everything
  // after it is the request. Matching the model as one word (not a run that
  // also swallows spaces) is what keeps the request from being eaten into the
  // model name.
  const promptMatch = text.match(/^\/prompt\b\s*(\S+)?\s*([\s\S]*)$/i);
  if (promptMatch) {
    const model = (promptMatch[1] ?? "").trim();
    const userText = promptMatch[2].trim();
    const target = model ? `the ${model} model` : "the right generator";
    const instruction = 
      `You are a world-class prompt engineer for generative media (image, video, audio). ` +
      `The user will describe — often roughly, in their own language — what they want to generate. ` +
      `Turn it into ONE production-grade generation prompt for ${target}, then stop.\n` +
      `- Write the final prompt in English (generators perform best in English) while staying faithful to the user's subject and intent.\n` +
      `- Be vivid and concrete: subject, composition, style, lighting, mood. For video add camera movement, motion and pacing; for audio add genre, instruments, tempo and mood.\n` +
      `- If the user refers to attached reference photos, cite them exactly as @image1, @image2 in the prompt — that is how the studio passes them to the model.\n` +
      `- Output ONLY the final prompt inside a <MagnetarPrompt>...</MagnetarPrompt> tag. No preamble, no alternatives, no explanation.`;
    return userText ? `${instruction}\n\nUser request:\n${userText}` : instruction;
  }

  const m = text.match(/^(\/[a-zа-яё]+)\s*([\s\S]*)$/i);
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

/** Precomputed per-file strings, so ranking does not re-lower-case every path
 *  on every keystroke (the dominant allocation in the fuzzy picker). */
interface FileEntry {
  path: string;
  lower: string;
  base: string;
}

// Keyed by array identity: the file list is stable while the user types, and a
// new list (project switch / refresh) rebuilds the index once.
let indexCache: { files: string[]; entries: FileEntry[] } | null = null;

function indexFiles(files: string[]): FileEntry[] {
  if (indexCache?.files === files) return indexCache.entries;
  const entries: FileEntry[] = files.map((path) => {
    const lower = path.toLowerCase();
    return { path, lower, base: lower.split("/").pop() ?? lower };
  });
  indexCache = { files, entries };
  return entries;
}

/** Subsequence match, the way editors score fuzzy file pickers: every query
 *  character must appear in order; matches on the basename rank higher. */
export function rankFiles(files: string[], query: string, limit = 30): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored: { path: string; score: number }[] = [];
  for (const { path, lower, base } of indexFiles(files)) {
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
