import { api } from "./api";
import { projectDecisions, renderDecisions } from "./decisions";
import { ensureProjectFacts, newFact, projectFacts, renderFacts } from "./facts";
import { pickMemory } from "./relevance";
import { buildVerify } from "./verifyspec";
import { verifyProjectFacts } from "./verify";
import { useStore } from "./store";
import { reportError } from "./errors";
import type { ChatMessage, Connection, FactKind, MemoryFact, Project, Session } from "./types";

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** Provenance marker for the auto-written "where we stopped" fact. */
const HANDOFF_SOURCE = "handoff";

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
  // Memory has to be in the store before the first prompt is built, not after.
  void ensureProjectFacts(existing.id);
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
    store.setIndexState({ status: "ready", files: r.files, skipped: r.skipped, at: Date.now() });
    store.logMemory({
      kind: "index",
      status: "ok",
      detail: `${r.files} files (+${r.changed}/-${r.removed}, ${r.skipped} skipped)`,
    });
  } catch (e) {
    store.setIndexState({ status: "error", at: Date.now() });
    const error = reportError(e, "memory.index");
    store.logMemory({ kind: "index", status: "error", detail: error.message });
  }

  let signals = "";
  const sentFiles: string[] = [];
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
      if (content) {
        signals += `\n## ${f}\n${content.slice(0, 4000)}\n`;
        sentFiles.push(f);
      }
    } catch {
      /* file absent — fine */
    }
  }

  // No manifest, no README, nothing to read: asking a model anyway is how the
  // memory of an empty folder filled up with a paraphrase of our own prompt —
  // "Outputs raw JSON format" recorded as the project's stack. A weak model
  // given no signals describes the instruction instead of the project. Empty
  // memory is the honest answer here, and the whole point of this design.
  if (sentFiles.length === 0) {
    const st0 = useStore.getState();
    const existing0 = st0.projects.find((p) => p.path === root);
    const at = Date.now();
    const project0: Project = existing0
      ? { ...existing0, path: root, updatedAt: at }
      : {
          id: uid(),
          name: root.split(/[/\\]/).pop() || "Project",
          path: root,
          // Nothing to migrate from, so the project starts out already migrated.
          factsMigratedAt: at,
          createdAt: at,
          updatedAt: at,
        };
    if (existing0) st0.updateProject(project0);
    else st0.addProject(project0);
    st0.setActiveProject(project0.id);
    const sid0 = st0.activeSessionId;
    if (sid0) st0.attachSessionToProject(sid0, project0.id);
    st0.logMemory({ kind: "audit", status: "skipped", detail: "memLogNoSignals" });
    return project0;
  }

  const instruction: ChatMessage = {
    id: "an",
    role: "user",
    content:
      `Analyze the project signals below and produce LONG-TERM project memory as a raw JSON object (no markdown):\n` +
      `{"name": "...", "description": "one sentence", "facts": [{"kind": "...", "text": "...", "source": "..."}]}\n` +
      `"kind" is one of: stack (languages, frameworks, storage), architecture (how it is put together), ` +
      `constraint (rules the code must obey), state (what is being worked on now).\n` +
      `"source" is the exact filename below the claim came from, or "inferred" when you concluded it yourself. ` +
      `Never write a filename you were not shown — a fact that lies about its source is worse than no fact.\n` +
      `One claim per fact, a single line each, no bullets. Base everything ONLY on the signals.\n\n${signals}`,
    createdAt: 0,
  };

  let parsed: Record<string, unknown> | null = null;
  try {
    const res = await api.complete(
      connection,
      model,
      [instruction],
      "You extract terse, checkable project facts. Return raw JSON only.",
    );
    parsed = JSON.parse(stripJson(res));
  } catch (e) {
    // The provider rejected the call (bad key, no access to this model, offline).
    // Surface it — a silent failure here is what leaves memory empty.
    const error = reportError(e, "memory.audit");
    store.setMemoryError(error.message);
    store.logMemory({
      kind: "audit",
      status: "error",
      detail: error.message,
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
  // Prefer what the model read out of a manifest, but never let it name a
  // project after the task it was given.
  const folderName = root.split(/[/\\]/).pop() || "Project";
  const proposed = asText(parsed.name)?.trim();
  const name = proposed && proposed.length < 60 ? proposed : folderName;

  const project: Project = {
    id: existing?.id ?? uid(),
    name,
    description: asText(parsed.description) ?? existing?.description,
    // The prose fields are no longer written to: memory lives in facts now.
    // They stay on the row so a project migrated from the old shape keeps its
    // safety net, and `factsMigratedAt` stops the migration re-running.
    techStack: existing?.techStack,
    architectureNotes: existing?.architectureNotes,
    codingStandards: existing?.codingStandards,
    decisions: existing?.decisions,
    activeGoals: existing?.activeGoals,
    roadmap: existing?.roadmap,
    risks: existing?.risks,
    lastState: existing?.lastState,
    path: root,
    factsMigratedAt: existing?.factsMigratedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) st.updateProject(project);
  else st.addProject(project);
  st.setActiveProject(project.id);

  // Facts, each carrying where it came from. A claim whose "source" names a
  // file we never showed the model is downgraded to "inferred" rather than
  // dropped: the claim may still be right, but its provenance is not.
  await ensureProjectFacts(project.id);
  const shown = new Set(sentFiles);
  const known: FactKind[] = ["stack", "architecture", "constraint", "state"];
  const rows: MemoryFact[] = [];
  for (const raw of Array.isArray(parsed.facts) ? parsed.facts : []) {
    const f = raw as Record<string, unknown>;
    const text = asText(f.text);
    if (!text?.trim()) continue;
    const kind = known.includes(f.kind as FactKind) ? (f.kind as FactKind) : "architecture";
    const source = asText(f.source)?.trim();
    const extracted = !!source && shown.has(source);
    rows.push(
      newFact(
        project.id,
        kind,
        text.slice(0, 400),
        extracted ? "extracted" : "inferred",
        extracted ? source : model,
        // A stack claim tied to a manifest is checkable by grep — the verifier
        // runs it later, nothing here believes it yet.
        buildVerify(extracted, kind, text, source),
      ),
    );
  }
  // A re-analysis replaces what a previous analysis produced — it does not pile
  // a second copy on top. Pressing the button three times used to mean three
  // copies of every fact, in the panel and in the prompt.
  //
  // Only machine-written facts are cleared: what the user typed, what was
  // migrated from the old notes, and the rolling handoff state were not written
  // by this pass and are not ours to discard.
  const stale = projectFacts(project.id).filter(
    (f) =>
      (f.origin === "extracted" || f.origin === "inferred") &&
      f.originDetail !== HANDOFF_SOURCE,
  );
  for (const f of stale) st.deleteFact(project.id, f.id);
  if (rows.length) st.saveFacts(rows);

  // Attach the current chat to this project so it works from memory.
  const sid = st.activeSessionId;
  if (sid) st.attachSessionToProject(sid, project.id);

  // Verify immediately, in the same pass. The check that runs on project open
  // happened seconds ago, before these facts existed — leaving every freshly
  // extracted fact sitting at "unverified" even though its evidence is one
  // grep away. Producing a checkable fact and checking it are one act.
  if (rows.length) {
    try {
      await verifyProjectFacts(root, project.id);
    } catch {
      /* verification reports its own failures through the memory log */
    }
  }

  st.logMemory({
    kind: "audit",
    status: "ok",
    detail: `${project.name} · ${rows.length}`,
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
      // "Where we stopped" is a fact like any other: a model wrote it, nobody
      // checked it, and it should say so. There is one per project — a handoff
      // replaces the previous one instead of piling up stale states.
      await ensureProjectFacts(p.id);
      const prev = projectFacts(p.id).find((f) => f.originDetail === HANDOFF_SOURCE);
      const fact = newFact(
        p.id,
        "state",
        note.trim().slice(0, 2000),
        "inferred",
        HANDOFF_SOURCE,
      );
      useStore.getState().saveFacts([
        prev ? { ...prev, text: fact.text, updatedAt: Date.now(), status: "unverified" } : fact,
      ]);
      useStore.getState().logMemory({
        kind: "handoff",
        status: "ok",
        projectId: p.id,
        model: picked.model,
      });
    }
  } catch (e) {
    const error = reportError(e, "memory.handoff");
    st.logMemory({
      kind: "handoff",
      status: "error",
      detail: error.message,
      model: picked.model,
    });
  }
}

/** Build the project-memory preamble injected into the AGENT system prompt so
 *  the agent starts from memory (brain + last handoff), not a cold read. */
export function buildProjectMemory(
  session: Session | undefined,
  /** What the user just asked. Memory is selected against it, the same way code
   *  is: dumping every fact wastes tokens and buries the two lines that matter. */
  query = "",
): string {
  const st = useStore.getState();

  // A "no project" conversation acts like a plain ChatGPT: the user explicitly
  // hid the project, so send no memory, no root, no facts. Keep a one-line
  // notice so an agent with tools does not go hunting for a project on disk.
  if (session?.seesProject === false) {
    return (
      `\n## Project context hidden\n` +
      `The user chose to hide the project for this conversation. Do not read project memory, ` +
      `list the workspace, or scan the filesystem; answer as a general assistant from the message alone.`
    );
  }

  const parts: string[] = [];

  // The open folder must reach the agent even when the project brain is empty —
  // without a root, list_dir/read_file have no path to work from.
  const root = st.workspaceRoot;
  if (root)
    parts.push(
      `\n## Workspace root\n${root}\n` +
        `Relative paths resolve here, and this is where the work belongs by default. ` +
        // It is a default, not a fence. Read as a fence, the agent refused to
        // make a folder on the Desktop the user had just asked for, and told
        // them to do it by hand instead.
        `It is not a boundary: when the user asks for something outside it, use an absolute path ` +
        `(~ works in run_bash) and do it — the usual confirmation still applies. ` +
        `Use search_code to locate things, then read_file.`,
    );
  else
    // Without this the model does the reasonable thing and goes hunting: it ran
    // `find /Users`, walked three unrelated projects, and settled on Magnetar's
    // own source tree as the place to write the user's pages. Say plainly that
    // there is no project and that looking for one is not the job.
    parts.push(
      `\n## No project folder is open\n` +
        `There is no workspace root, so relative paths lead nowhere and writing files is refused.\n` +
        `Do NOT go looking for a project: no scanning the home directory, no \`find /Users\`, no guessing from folder names. ` +
        `Whatever you found that way would be the wrong project, and writing into it damages something the user did not ask you to touch.\n` +
        `If the task needs files, call new_project with a short name for the work: the app will create a folder in the user's Documents, ask them to confirm, and open it. ` +
        `If they decline, say in one line that a folder has to be opened first and stop. ` +
        `Questions that need no files — explaining, planning, reviewing text — answer normally.`,
    );

  const memory = buildMemorySection(session, query);
  if (memory) parts.push(memory);
  else return parts.join("\n");

  parts.push(
    `\nThis memory is background context about the project — it is NOT a substitute for the code.` +
      ` To change or explain anything concrete, always locate it in the real files first` +
      ` (search_code, then read_file). Never answer from memory alone about code you have not read,` +
      ` and never claim a file or symbol exists without finding it.` +
      ` Prefer read_file(offset,limit) over reading whole files to save tokens.`,
  );
  return parts.join("\n");
}

/** The project's memory, with no assumptions about what the reader can do.
 *
 *  This is the one renderer. It used to have a second implementation in
 *  `handoff.ts`, which read the old prose fields instead of facts — so plain
 *  chat and the agent were shown different memory for the same project, and
 *  only one of them could say where any of it came from. Which of two answers
 *  you got depended on which tab you happened to be in.
 *
 *  Returns "" when the session has no project or the user hid it.
 */
export function buildMemorySection(
  /** Only the two fields that decide what memory to show — so a caller that
   *  has a project but no conversation (the subscription bridge) can ask for
   *  the same rendering without inventing a session to pass in. */
  scope: { projectId?: string; seesProject?: boolean } | undefined,
  query = "",
): string {
  if (scope?.seesProject === false) return "";
  const st = useStore.getState();
  const p = scope?.projectId
    ? st.projects.find((x) => x.id === scope.projectId)
    : undefined;
  if (!p) return "";

  const parts: string[] = [`\n## Project memory: ${p.name}`];
  if (p.path) parts.push(`Path: ${p.path}`);
  if (p.description) parts.push(`Description: ${p.description}`);

  const picked = pickMemory(projectFacts(p.id), projectDecisions(p.id), query);
  if (picked.facts.length) parts.push(renderFacts(picked.facts));
  else if (!p.factsMigratedAt) {
    // Not migrated yet (the project has not been opened since facts landed).
    // Falling back to the prose keeps memory working; it just cannot say where
    // any of it came from.
    if (p.techStack) parts.push(`Tech stack:\n${p.techStack}`);
    if (p.architectureNotes) parts.push(`Architecture:\n${p.architectureNotes}`);
    if (p.codingStandards) parts.push(`Coding standards:\n${p.codingStandards}`);
    if (p.lastState) parts.push(`\n## Where the previous model stopped\n${p.lastState}`);
  }
  if (picked.decisions.length) parts.push(renderDecisions(picked.decisions));
  else if (!p.decisionsMigratedAt && p.decisions)
    parts.push(`Decisions:\n${p.decisions}`);

  parts.push(
    `\nOnly the memory relevant to this request is shown — the project may hold more.`,
  );
  return parts.join("\n");
}
