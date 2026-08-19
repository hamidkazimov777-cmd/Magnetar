import { api } from "./api";
import { useStore } from "./store";
import type { ChatMessage, Connection, Project, Session } from "./types";

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** Memory fields are typed as strings, but they come from a model's JSON and it
 *  routinely answers with arrays ("techStack": ["React","Tauri"]) or nested
 *  objects. Storing those verbatim crashed every consumer that called .trim()
 *  on them — the project panel died with "e?.trim is not a function". Flatten
 *  everything to text at the boundary. */
function asText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .map((x) => (typeof x === "string" ? x : asText(x)))
      .filter(Boolean)
      .map((line) => (line!.startsWith("-") ? line! : `- ${line}`))
      .join("\n");
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `- ${k}: ${asText(val) ?? ""}`)
      .join("\n");
  return String(v);
}

function stripJson(s: string): string {
  const t = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

/** Pick the cheapest available model for background memory work (summaries,
 *  analysis) so we don't burn the expensive model on housekeeping. */
export function cheapModel(): { connection: Connection; model: string } | null {
  const st = useStore.getState();

  // 1. An explicit choice always wins — this is what Settings sets.
  const pinned = st.prefs?.memoryModel;
  if (pinned) {
    const conn = st.connections.find((c) => c.id === pinned.connectionId);
    if (conn) return { connection: conn, model: pinned.model };
  }

  const usable = (connId: string, modelId: string) =>
    // Never re-pick a model the provider already refused (403/404), and only
    // consider connections whose catalogue loaded (i.e. the key works).
    st.modelStatus?.[`${connId}::${modelId}`] !== "denied";

  // 2. Otherwise look for a small/cheap model, skipping known-bad ones.
  const cheapRe = /(haiku|mini|nano|flash|lite|small|8b|7b|1\.5b|3b)/i;
  for (const conn of st.connections) {
    for (const m of st.models[conn.id] ?? []) {
      if (cheapRe.test(m.id) && usable(conn.id, m.id))
        return { connection: conn, model: m.id };
    }
  }

  // 3. Fall back to the active model, then to anything that is not refused.
  const active = st.connections.find((c) => c.id === st.activeConnectionId);
  if (active && st.activeModel && usable(active.id, st.activeModel))
    return { connection: active, model: st.activeModel };

  for (const conn of st.connections) {
    for (const m of st.models[conn.id] ?? []) {
      if (usable(conn.id, m.id)) return { connection: conn, model: m.id };
    }
  }
  return null;
}

const KEY_FILES = [
  "package.json",
  "README.md",
  "readme.md",
  "Cargo.toml",
  "src-tauri/Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "tsconfig.json",
  "pom.xml",
  "Gemfile",
];

/** A folder IS a project. Opening one must select its project immediately —
 *  before, and independently of, the audit that fills memory. Otherwise a
 *  failed or slow audit leaves the workspace pointing at someone else's
 *  project (or none), and every memory write goes to the wrong place. */
export function activateProjectForPath(root: string): boolean {
  const st = useStore.getState();
  const existing = st.projects.find((p) => p.path === root);
  if (!existing) return false;
  st.setActiveProject(existing.id);
  const sid = st.activeSessionId;
  const session = st.sessions.find((x) => x.id === sid);
  // Adopt the current chat only when it is not already someone else's work.
  if (sid && session && (!session.projectId || session.messages.length === 0))
    st.attachSessionToProject(sid, existing.id);
  return true;
}

/** Onboarding: the app analyzes a project folder and fills long-term memory
 *  (Project Brain) — so a model can later work from memory instead of re-reading
 *  the whole project. Best-effort, uses the cheap model. */
export async function analyzeFolderIntoMemory(
  root: string,
): Promise<Project | null> {
  const store = useStore.getState();
  store.setMemoryError(undefined);

  const picked = cheapModel();
  if (!picked) {
    // No usable model — say so instead of leaving an empty "New Project".
    store.setMemoryError("memErrNoModel");
    store.logMemory({ kind: "audit", status: "error", detail: "memErrNoModel" });
    return null;
  }
  const { connection, model } = picked;

  // Build the retrieval index too (used later by search_code).
  store.setIndexState({ status: "building" });
  try {
    const r = await api.indexBuild(root);
    store.setIndexState({ status: "ready", files: r.files, at: Date.now() });
    store.logMemory({ kind: "index", status: "ok", detail: String(r.files) });
  } catch (e) {
    store.setIndexState({ status: "error", at: Date.now() });
    store.logMemory({ kind: "index", status: "error", detail: String(e).slice(0, 200) });
  }

  let signals = "";
  try {
    const top = await api.toolListDir(root);
    signals +=
      "## Top-level entries:\n" +
      top.map((e) => (e.isDir ? e.name + "/" : e.name)).join(", ") +
      "\n";
  } catch {
    /* ignore */
  }
  for (const f of KEY_FILES) {
    try {
      const content = await api.editorReadFile(`${root}/${f}`);
      if (content) signals += `\n## ${f}\n${content.slice(0, 4000)}\n`;
    } catch {
      /* file absent — fine */
    }
  }

  const instruction: ChatMessage = {
    id: "an",
    role: "user",
    content:
      `Analyze the project signals below and produce concise LONG-TERM project memory as a raw JSON object (no markdown), with keys: ` +
      `"name", "description", "techStack", "architectureNotes", "codingStandards". ` +
      `Base it ONLY on the signals. Keep every field terse and thesis-like (short bullet lines).\n\n${signals}`,
    createdAt: 0,
  };

  let parsed: Record<string, unknown> | null = null;
  try {
    const res = await api.complete(
      connection,
      model,
      [instruction],
      "You extract terse, information-dense project memory. Return raw JSON only.",
    );
    parsed = JSON.parse(stripJson(res));
  } catch (e) {
    // The provider rejected the call (bad key, no access to this model, offline).
    // Surface it — a silent failure here is what leaves memory empty.
    store.setMemoryError(String(e).slice(0, 300));
    store.logMemory({
      kind: "audit",
      status: "error",
      detail: String(e).slice(0, 200),
      model,
    });
    return null;
  }
  if (!parsed) {
    store.setMemoryError("memErrParse");
    store.logMemory({ kind: "audit", status: "error", detail: "memErrParse", model });
    return null;
  }

  const st = useStore.getState();
  const existing = st.projects.find((p) => p.path === root);
  const now = Date.now();
  const name = asText(parsed.name) || root.split(/[/\\]/).pop() || "Project";

  const project: Project = {
    id: existing?.id ?? uid(),
    name,
    description: asText(parsed.description) ?? existing?.description,
    techStack: asText(parsed.techStack) ?? existing?.techStack,
    architectureNotes: asText(parsed.architectureNotes) ?? existing?.architectureNotes,
    codingStandards: asText(parsed.codingStandards) ?? existing?.codingStandards,
    decisions: existing?.decisions,
    activeGoals: existing?.activeGoals,
    roadmap: existing?.roadmap,
    risks: existing?.risks,
    lastState: existing?.lastState,
    path: root,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) st.updateProject(project);
  else st.addProject(project);
  st.setActiveProject(project.id);

  // Attach the current chat to this project so it works from memory.
  const sid = st.activeSessionId;
  if (sid) st.attachSessionToProject(sid, project.id);

  st.logMemory({
    kind: "audit",
    status: "ok",
    detail: project.name,
    projectId: project.id,
    model,
  });

  return project;
}

/** On model switch: flush the just-done work into project memory as a terse
 *  "current state / next step" thesis, so the next model continues from memory
 *  without re-reading the transcript or the project. */
export async function flushHandoffToMemory(
  opts: { manual?: boolean } = {},
): Promise<void> {
  const st = useStore.getState();
  const session = st.sessions.find((s) => s.id === st.activeSessionId);

  // A manual "save state" click must explain itself when it cannot run;
  // the automatic path on model switch stays quiet about preconditions.
  const bail = (detail: string) => {
    if (opts.manual) st.logMemory({ kind: "handoff", status: "skipped", detail });
  };

  if (!session?.projectId) return bail("memLogNoProject");
  const msgs = session.messages.filter((m) => m.content);
  if (msgs.length < 2) return bail("memLogTooShort");

  const picked = cheapModel();
  if (!picked) return bail("memErrNoModel");

  const recent = msgs
    .slice(-8)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const instruction: ChatMessage = {
    id: "fl",
    role: "user",
    content:
      `Write a terse handoff note so ANOTHER AI model can continue WITHOUT re-reading the project. ` +
      `Capture: current state, what was just done, open questions, and the exact next step. Bullet points, no preamble.\n\n${recent}`,
    createdAt: 0,
  };

  try {
    const note = await api.complete(
      picked.connection,
      picked.model,
      [instruction],
      "You write terse engineering handoff notes.",
    );
    if (!note.trim()) {
      st.logMemory({ kind: "handoff", status: "error", detail: "memErrEmpty" });
      return;
    }
    const p = useStore.getState().projects.find((x) => x.id === session.projectId);
    if (p) {
      useStore
        .getState()
        .updateProject({ ...p, lastState: note.trim(), updatedAt: Date.now() });
      useStore.getState().logMemory({
        kind: "handoff",
        status: "ok",
        projectId: p.id,
        model: picked.model,
      });
    }
  } catch (e) {
    st.logMemory({
      kind: "handoff",
      status: "error",
      detail: String(e).slice(0, 200),
      model: picked.model,
    });
  }
}

/** Build the project-memory preamble injected into the AGENT system prompt so
 *  the agent starts from memory (brain + last handoff), not a cold read. */
export function buildProjectMemory(session: Session | undefined): string {
  const st = useStore.getState();
  const parts: string[] = [];

  // The open folder must reach the agent even when the project brain is empty —
  // without a root, list_dir/read_file have no path to work from.
  const root = st.workspaceRoot;
  if (root)
    parts.push(
      `\n## Workspace root\n${root}\nAll relative paths resolve here. Use search_code to locate things, then read_file.`,
    );

  const p = session?.projectId
    ? st.projects.find((x) => x.id === session.projectId)
    : undefined;
  if (!p) return parts.join("\n");

  parts.push(`\n## Project memory: ${p.name}`);
  if (p.path) parts.push(`Path: ${p.path}`);
  if (p.description) parts.push(`Description: ${p.description}`);
  if (p.techStack) parts.push(`Tech stack:\n${p.techStack}`);
  if (p.architectureNotes) parts.push(`Architecture:\n${p.architectureNotes}`);
  if (p.codingStandards) parts.push(`Coding standards:\n${p.codingStandards}`);
  if (p.decisions) parts.push(`Decisions:\n${p.decisions}`);
  if (p.lastState)
    parts.push(`\n## Where the previous model stopped (continue from here)\n${p.lastState}`);
  parts.push(
    `\nThis memory is background context about the project — it is NOT a substitute for the code.` +
      ` To change or explain anything concrete, always locate it in the real files first` +
      ` (search_code, then read_file). Never answer from memory alone about code you have not read,` +
      ` and never claim a file or symbol exists without finding it.` +
      ` Prefer read_file(offset,limit) over reading whole files to save tokens.`,
  );
  return parts.join("\n");
}
