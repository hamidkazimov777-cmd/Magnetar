import { api } from "./api";
import { useStore } from "./store";
import type { Decision, Project } from "./types";

/* ==========================================================================
   DECISIONS AS AN EVENT LOG

   A text field called "Architectural decisions" answers the wrong question.
   In six months the architecture is readable straight from the files; what is
   gone is the reason it was chosen and what was rejected on the way. So a
   decision is an event: what was decided, when, why, what lost, which files it
   touches, and the commit the project stood at.
   ========================================================================== */

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** The commit the project is standing at right now, if it is a git repo.
 *  Best-effort: a decision without a commit is still a decision. */
async function headSha(root: string | undefined): Promise<string | undefined> {
  if (!root) return undefined;
  try {
    const r = await api.gitExec(root, ["rev-parse", "--short", "HEAD"]);
    const sha = r.stdout.trim();
    return r.code === 0 && sha ? sha : undefined;
  } catch {
    return undefined;
  }
}

/** Record a decision at the moment it is made. */
export async function recordDecision(
  projectId: string,
  d: {
    title: string;
    rationale?: string;
    alternatives?: string;
    files?: string[];
    origin?: Decision["origin"];
  },
): Promise<Decision | null> {
  const title = d.title.trim();
  if (!title) return null;
  const st = useStore.getState();
  const root = st.projects.find((p) => p.id === projectId)?.path ?? st.workspaceRoot;

  const row: Decision = {
    id: uid(),
    projectId,
    title,
    rationale: d.rationale?.trim() || undefined,
    alternatives: d.alternatives?.trim() || undefined,
    files: d.files?.length ? JSON.stringify(d.files) : undefined,
    commitSha: await headSha(root),
    origin: d.origin ?? "user",
    createdAt: Date.now(),
  };
  useStore.getState().saveDecision(row);
  useStore.getState().logMemory({
    kind: "handoff",
    status: "ok",
    detail: title.slice(0, 80),
    projectId,
  });
  return row;
}

/** One-time split of the old `decisions` prose field into log entries.
 *
 *  Each line becomes a decision with no rationale, because the old field never
 *  held one — and an empty "why" that says so is more useful than a fabricated
 *  one. */
async function migrateLegacyDecisions(p: Project): Promise<void> {
  if (p.decisionsMigratedAt) return;
  const st = useStore.getState();
  const lines = (p.decisions ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 1)
    .slice(0, 60);

  const at = p.updatedAt || Date.now();
  lines.forEach((title, i) =>
    st.saveDecision({
      id: uid(),
      projectId: p.id,
      title: title.slice(0, 400),
      origin: "legacy",
      // Keep the original order readable: the log sorts newest first.
      createdAt: at - (lines.length - i) * 1000,
    }),
  );
  st.updateProject({ ...p, decisionsMigratedAt: Date.now(), updatedAt: Date.now() });
}

/** Load the project's decision log, migrating the old field on first sight. */
export async function ensureProjectDecisions(projectId: string): Promise<void> {
  const st = useStore.getState();
  if (!st.decisions[projectId]) await st.loadDecisions(projectId);
  const p = useStore.getState().projects.find((x) => x.id === projectId);
  if (p) await migrateLegacyDecisions(p);
}

export function projectDecisions(projectId: string | undefined): Decision[] {
  if (!projectId) return [];
  return useStore.getState().decisions[projectId] ?? [];
}

export function decisionFiles(d: Decision): string[] {
  if (!d.files) return [];
  try {
    const v = JSON.parse(d.files);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Render the log for the system prompt. Only the most recent entries: the
 *  point is to stop the model re-litigating settled questions, and a decision
 *  from two hundred entries ago is not what the current task is about. */
export function renderDecisions(list: Decision[], limit = 12): string {
  if (!list.length) return "";
  const lines = list.slice(0, limit).map((d) => {
    const head = `- ${day(d.createdAt)}${d.commitSha ? ` @${d.commitSha}` : ""}: ${d.title}`;
    const why = d.rationale ? `\n    why: ${d.rationale}` : "";
    const alt = d.alternatives ? `\n    rejected: ${d.alternatives}` : "";
    const files = decisionFiles(d).length
      ? `\n    files: ${decisionFiles(d).slice(0, 8).join(", ")}`
      : "";
    return head + why + alt + files;
  });
  return (
    `\n## Decisions already made (do not re-open without saying why)\n` +
    lines.join("\n") +
    `\nIf the task contradicts one of these, say which one and why before writing code.`
  );
}
