import { api } from "./api";
import { newFact } from "./facts";
import { useStore } from "./store";
import type { Decision, MemoryFact } from "./types";

/* ==========================================================================
   EXPORTING WHAT MAGNETAR REMEMBERS

   Debugging memory from screenshots is guesswork: a panel shows what fits on
   screen, not the provenance, the verify spec, or the reason a check failed.
   This writes the whole thing out as one file — facts with their origins and
   statuses, decisions, the divergence queue, and the memory log — so a problem
   can be read instead of squinted at.
   ========================================================================== */

export interface MemorySnapshot {
  exportedAt: string;
  project: Record<string, unknown> | null;
  facts: unknown[];
  decisions: unknown[];
  divergences: unknown[];
  memoryLog: unknown[];
  /** The exact system context of the last request — what the model really saw. */
  lastContext?: { model?: string; at?: number; system?: string };
  environment: Record<string, unknown>;
}

export function buildSnapshot(): MemorySnapshot {
  const st = useStore.getState();
  const id = st.activeProjectId;
  const project = id ? st.projects.find((p) => p.id === id) : undefined;

  return {
    exportedAt: new Date().toISOString(),
    project: project ? { ...project } : null,
    facts: id ? (st.facts[id] ?? []) : [],
    decisions: id ? (st.decisions[id] ?? []) : [],
    divergences: id ? (st.divergences[id] ?? []) : [],
    memoryLog: st.memoryLog,
    lastContext: st.lastContext
      ? {
          model: st.lastContext.model,
          at: st.lastContext.at,
          // The system prompt can be long; the point is what memory reached the
          // model, and that lives at the top.
          system: st.lastContext.system?.slice(0, 20000),
        }
      : undefined,
    environment: {
      workspaceRoot: st.workspaceRoot,
      activeModel: st.activeModel,
      activeTrack: st.activeTrack,
      memoryModel: st.prefs?.memoryModel ?? null,
      indexState: st.indexState ?? null,
      connections: st.connections.map((c) => ({
        // Never the key, and never anything derived from it.
        name: c.name,
        kind: c.kind,
        baseUrl: c.baseUrl,
      })),
    },
  };
}

/** Ask where to put it, then write it. Returns the path, or null if cancelled. */
export async function exportMemorySnapshot(): Promise<string | null> {
  const st = useStore.getState();
  const name = st.projects.find((p) => p.id === st.activeProjectId)?.name ?? "project";
  const stamp = new Date().toISOString().slice(0, 10);
  const suggested = `magnetar-memory-${name.replace(/[^\w.-]+/g, "-").toLowerCase()}-${stamp}.json`;

  // The backend opens the dialog, so naming the destination is what grants
  // access to it — otherwise saving outside the project would ask twice.
  const path = await api.pickSavePath(suggested, ["json"]);
  if (!path) return null;

  await api.toolWriteFile(path, JSON.stringify(buildSnapshot(), null, 2));
  return path;
}


/* ==========================================================================
   READING ONE BACK

   A snapshot is only half a backup if nothing can restore it. Import is
   deliberately additive and deliberately dumb about identity: memory that came
   from somewhere else arrives as new facts belonging to the open project,
   marked as imported, rather than overwriting what is already there by id.

   Overwriting would be the wrong default in the one case that matters — a
   person restoring after losing work does not want the file to win silently
   over whatever survived.
   ========================================================================== */

export interface ImportPlan {
  facts: MemoryFact[];
  decisions: Decision[];
  /** Rows that were left out, with the reason, so nothing vanishes quietly. */
  skipped: string[];
}

const asString = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Parse a snapshot file. Returns the plan, or throws with a readable reason. */
export function planImport(json: string, projectId: string, existing: MemoryFact[]): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("not a Magnetar memory export: the file is not valid JSON");
  }
  const snapshot = parsed as Partial<MemorySnapshot>;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.facts))
    throw new Error("not a Magnetar memory export: no facts in it");

  const skipped: string[] = [];
  const seen = new Set(existing.map((f) => f.text.toLowerCase()));

  const facts: MemoryFact[] = [];
  for (const raw of snapshot.facts) {
    const f = raw as Record<string, unknown>;
    const text = asString(f.text, 400);
    if (text.length < 3) {
      skipped.push("a fact with no text");
      continue;
    }
    if (seen.has(text.toLowerCase())) {
      skipped.push(`already known: ${text.slice(0, 60)}`);
      continue;
    }
    seen.add(text.toLowerCase());
    const kind = ["stack", "architecture", "constraint", "state"].includes(String(f.kind))
      ? (f.kind as MemoryFact["kind"])
      : "architecture";
    // Imported, not verified. Whatever status it had in the file was true of
    // another machine at another time, and carrying it over would be claiming
    // a check that nobody ran here.
    facts.push(newFact(projectId, kind, text, "legacy", "imported"));
  }

  const decisions: Decision[] = [];
  for (const raw of Array.isArray(snapshot.decisions) ? snapshot.decisions : []) {
    const d = raw as Record<string, unknown>;
    const title = asString(d.title, 200);
    if (title.length < 3) {
      skipped.push("a decision with no title");
      continue;
    }
    decisions.push({
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      projectId,
      title,
      rationale: asString(d.rationale, 1000) || undefined,
      alternatives: asString(d.alternatives, 1000) || undefined,
      origin: "legacy",
      createdAt: Date.now(),
    });
  }

  return { facts, decisions, skipped };
}

/** Ask for a file, plan the import, and apply it. Returns what happened. */
export async function importMemorySnapshot(): Promise<ImportPlan | null> {
  const st = useStore.getState();
  const projectId = st.activeProjectId;
  if (!projectId) throw new Error("open a project first — memory belongs to one");

  const chosen = await api.pickAttachments(["json"]);
  if (!chosen.length) return null;

  const json = atob(await api.readFileBase64(chosen[0]));
  const plan = planImport(json, projectId, st.facts[projectId] ?? []);

  if (plan.facts.length) useStore.getState().saveFacts(plan.facts);
  for (const d of plan.decisions) useStore.getState().saveDecision(d);
  useStore.getState().logMemory({
    kind: "audit",
    status: "ok",
    detail: `imported ${plan.facts.length} facts, ${plan.decisions.length} decisions`,
    projectId,
  });
  return plan;
}
