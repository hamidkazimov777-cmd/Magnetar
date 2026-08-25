import { save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { useStore } from "./store";

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

  const path = await save({
    defaultPath: suggested,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;

  await api.toolWriteFile(path, JSON.stringify(buildSnapshot(), null, 2));
  return path;
}
