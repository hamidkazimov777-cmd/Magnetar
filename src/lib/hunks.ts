import { api } from "./api";

/* ==========================================================================
   STAGING AND DISCARDING ONE HUNK AT A TIME

   Staging a whole file when you only meant one change is how an unrelated edit
   rides into a commit. Git itself solves this with `add -p`, an interactive
   prompt no GUI can host — so a GUI has to do what that prompt does under the
   hood: take the file's diff, isolate a single hunk, and hand git a patch
   containing only that hunk plus the headers it needs to locate the file.

   The construction is the part that goes wrong silently — a patch with the
   wrong line counts applies to the wrong place, or is rejected as corrupt — so
   parsing and patch-building are pure functions here, tested, with the actual
   `git apply` a thin call after them.
   ========================================================================== */

export interface Hunk {
  /** The `@@ -a,b +c,d @@` line and everything under it, verbatim. */
  header: string;
  lines: string[];
  /** For a label: how many lines were added and removed. */
  added: number;
  removed: number;
}

export interface FileDiff {
  /** The `diff --git`, `index`, `---`, `+++` lines: the preamble a patch needs
   *  to know which file it touches. Kept verbatim so a rename or a mode change
   *  is preserved rather than reconstructed. */
  preamble: string;
  hunks: Hunk[];
}

/** Split `git diff` output for a single file into its preamble and hunks. */
export function parseFileDiff(diff: string): FileDiff {
  const lines = diff.split("\n");
  const preamble: string[] = [];
  const hunks: Hunk[] = [];
  let i = 0;

  // Everything before the first `@@` is the preamble.
  while (i < lines.length && !lines[i].startsWith("@@")) {
    preamble.push(lines[i]);
    i++;
  }

  while (i < lines.length) {
    if (!lines[i].startsWith("@@")) {
      i++;
      continue;
    }
    const header = lines[i];
    i++;
    const body: string[] = [];
    let added = 0;
    let removed = 0;
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
      const line = lines[i];
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
      body.push(line);
      i++;
    }
    // A trailing empty string from the final split is not a diff line.
    while (body.length && body[body.length - 1] === "") body.pop();
    hunks.push({ header, lines: body, added, removed });
  }

  return { preamble: preamble.join("\n"), hunks };
}

/** Build a patch containing exactly one hunk, ready for `git apply`.
 *
 *  The preamble is required — without the `+++ b/path` line git does not know
 *  which file the hunk belongs to — and the patch has to end in a newline or
 *  the last hunk is rejected as corrupt.
 */
export function buildHunkPatch(preamble: string, hunk: Hunk): string {
  const parts = [preamble, hunk.header, ...hunk.lines];
  return parts.join("\n") + "\n";
}

async function fileDiff(root: string, path: string, staged: boolean): Promise<FileDiff> {
  const args = ["diff", ...(staged ? ["--cached"] : []), "--", path];
  const r = await api.gitExec(root, args);
  return parseFileDiff(r.stdout);
}

/** The hunks in a file's current diff, unstaged or staged. */
export async function fileHunks(
  root: string,
  path: string,
  staged: boolean,
): Promise<FileDiff> {
  return fileDiff(root, path, staged);
}

function applyResult(r: { code: number; stderr: string; stdout: string }): void {
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || "git apply failed").trim().slice(0, 300));
  }
}

/** Move one unstaged hunk into the index. */
export async function stageHunk(root: string, diff: FileDiff, hunk: Hunk): Promise<void> {
  const patch = buildHunkPatch(diff.preamble, hunk);
  applyResult(await api.gitApply(root, ["--cached"], patch));
}

/** Take one staged hunk back out of the index. Reverse-apply against the index
 *  is how git un-stages a hunk: the same patch, undone. */
export async function unstageHunk(root: string, diff: FileDiff, hunk: Hunk): Promise<void> {
  const patch = buildHunkPatch(diff.preamble, hunk);
  applyResult(await api.gitApply(root, ["--cached", "-R"], patch));
}

/** Throw one unstaged hunk away. Reverse-apply against the working tree.
 *
 *  This is the destructive one and has no undo: git keeps no record of a
 *  working-tree change it never committed. The caller confirms before calling.
 */
export async function discardHunk(root: string, diff: FileDiff, hunk: Hunk): Promise<void> {
  const patch = buildHunkPatch(diff.preamble, hunk);
  applyResult(await api.gitApply(root, ["-R"], patch));
}
