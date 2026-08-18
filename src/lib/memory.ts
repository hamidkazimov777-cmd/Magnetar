import { api } from "./api";
import { useStore } from "./store";
import type { ChatMessage, Connection, Project, Session } from "./types";

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

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
  const cheapRe = /(haiku|mini|nano|flash|lite|small|8b|7b|1\.5b|3b)/i;
  for (const conn of st.connections) {
    for (const m of st.models[conn.id] ?? []) {
      if (cheapRe.test(m.id)) return { connection: conn, model: m.id };
    }
  }
  // Fallback: the active connection/model.
  const conn = st.connections.find((c) => c.id === st.activeConnectionId);
  if (conn && st.activeModel) return { connection: conn, model: st.activeModel };
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

/** Onboarding: the app analyzes a project folder and fills long-term memory
 *  (Project Brain) — so a model can later work from memory instead of re-reading
 *  the whole project. Best-effort, uses the cheap model. */
export async function analyzeFolderIntoMemory(
  root: string,
): Promise<Project | null> {
  const picked = cheapModel();
  if (!picked) return null;
  const { connection, model } = picked;

  // Build the retrieval index too (used later by search_code).
  try {
    await api.indexBuild(root);
  } catch {
    /* ignore */
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

  let parsed: Record<string, string> | null = null;
  try {
    const res = await api.complete(
      connection,
      model,
      [instruction],
      "You extract terse, information-dense project memory. Return raw JSON only.",
    );
    parsed = JSON.parse(stripJson(res));
  } catch {
    return null;
  }
  if (!parsed) return null;

  const st = useStore.getState();
  const existing = st.projects.find((p) => p.path === root);
  const now = Date.now();
  const name = parsed.name || root.split(/[/\\]/).pop() || "Project";

  const project: Project = {
    id: existing?.id ?? uid(),
    name,
    description: parsed.description ?? existing?.description,
    techStack: parsed.techStack ?? existing?.techStack,
    architectureNotes: parsed.architectureNotes ?? existing?.architectureNotes,
    codingStandards: parsed.codingStandards ?? existing?.codingStandards,
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

  return project;
}

/** On model switch: flush the just-done work into project memory as a terse
 *  "current state / next step" thesis, so the next model continues from memory
 *  without re-reading the transcript or the project. */
export async function flushHandoffToMemory(): Promise<void> {
  const st = useStore.getState();
  const session = st.sessions.find((s) => s.id === st.activeSessionId);
  if (!session?.projectId) return;
  const msgs = session.messages.filter((m) => m.content);
  if (msgs.length < 2) return;

  const picked = cheapModel();
  if (!picked) return;

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
    if (!note.trim()) return;
    const p = useStore.getState().projects.find((x) => x.id === session.projectId);
    if (p)
      useStore
        .getState()
        .updateProject({ ...p, lastState: note.trim(), updatedAt: Date.now() });
  } catch {
    /* non-critical */
  }
}

/** Build the project-memory preamble injected into the AGENT system prompt so
 *  the agent starts from memory (brain + last handoff), not a cold read. */
export function buildProjectMemory(session: Session | undefined): string {
  if (!session?.projectId) return "";
  const st = useStore.getState();
  const p = st.projects.find((x) => x.id === session.projectId);
  if (!p) return "";
  const parts: string[] = [`\n## Project memory: ${p.name}`];
  if (p.path) parts.push(`Path: ${p.path}`);
  if (p.description) parts.push(`Description: ${p.description}`);
  if (p.techStack) parts.push(`Tech stack:\n${p.techStack}`);
  if (p.architectureNotes) parts.push(`Architecture:\n${p.architectureNotes}`);
  if (p.codingStandards) parts.push(`Coding standards:\n${p.codingStandards}`);
  if (p.decisions) parts.push(`Decisions:\n${p.decisions}`);
  if (p.lastState)
    parts.push(`\n## Where the previous model stopped (continue from here)\n${p.lastState}`);
  parts.push(
    `\nWork from this memory first. Prefer search_code / read_file(offset,limit) over reading whole files — save tokens.`,
  );
  return parts.join("\n");
}
