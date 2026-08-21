import type { SubagentTask } from "./subagents";

/* ==========================================================================
   FILE LEASES

   The rule that keeps parallel helpers from destroying each other's work: a
   task declares the files it will change, and a task whose files are already
   claimed does not start. Two agents editing one file do not merge — the
   second write wins and the first one's work disappears with nothing on
   screen to show it happened.

   Kept free of other imports so it can be exercised on its own.
   ========================================================================== */

/** Normalise a declared path so two spellings of the same file collide. */
const normalise = (root: string | undefined, p: string): string => {
  const t = p.trim().replace(/^\.\//, "");
  if (!root) return t;
  return t.startsWith("/") ? t : `${root}/${t}`;
};

/** Refuse tasks whose file sets intersect — with the ones that got through
 *  first keeping their claim. The lead is told which were refused and why, so
 *  it can re-split the work rather than silently losing it. */
export function resolveLeases(
  tasks: SubagentTask[],
  root: string | undefined,
): { accepted: SubagentTask[]; refused: { title: string; reason: string }[] } {
  const taken = new Map<string, string>(); // file -> task title
  const accepted: SubagentTask[] = [];
  const refused: { title: string; reason: string }[] = [];

  for (const task of tasks) {
    const files = (task.files ?? []).map((f) => normalise(root, f));
    const clash = files.find((f) => taken.has(f));
    if (clash) {
      refused.push({
        title: task.title,
        reason: `file already claimed by "${taken.get(clash)}": ${clash}`,
      });
      continue;
    }
    for (const f of files) taken.set(f, task.title);
    accepted.push(task);
  }
  return { accepted, refused };
}
