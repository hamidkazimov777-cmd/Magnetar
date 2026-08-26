import { db } from "../db";
import { reportError, reportPromise } from "../errors";
import type { Decision, Divergence, MemoryEvent, MemoryFact, Proposal } from "../types";
import { now, uid } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   PROJECT MEMORY

   Facts, the decision log, queued contradictions and the proposals a model
   made — all keyed by project and loaded per project, because only the open
   project's memory is ever consulted.

   Every read failure here is reported rather than swallowed. A memory panel
   that failed to load looks exactly like a project that has no memory, and
   those two need telling apart without a debugger.
   ========================================================================== */

export interface MemorySlice {
  /** Project memory as facts, keyed by project id. Loaded per project rather
   *  than all at once: only the open project's memory is ever consulted. */
  facts: Record<string, MemoryFact[]>;
  loadFacts: (projectId: string) => Promise<void>;
  /** Insert or update a batch. One call, one write — callers routinely produce
   *  a dozen facts at a time (an audit, a migration), and a save per fact made
   *  the panel flicker through a dozen intermediate states. */
  saveFacts: (facts: MemoryFact[]) => void;
  deleteFact: (projectId: string, id: string) => void;

  /** Queued contradictions between memory and the code, keyed by project. */
  divergences: Record<string, Divergence[]>;
  loadDivergences: (projectId: string) => Promise<void>;
  saveDivergence: (d: Divergence) => void;

  /** The decision log, keyed by project id. Newest first. */
  decisions: Record<string, Decision[]>;
  loadDecisions: (projectId: string) => Promise<void>;
  saveDecision: (d: Decision) => void;
  deleteDecision: (projectId: string, id: string) => void;

  /** Model proposals the user accepted/rejected, keyed by project. */
  proposals: Record<string, Proposal[]>;
  loadProposals: (projectId: string) => Promise<void>;
  saveProposal: (p: Proposal) => void;

  /** Audit trail of every background write to project memory. */
  memoryLog: MemoryEvent[];
  logMemory: (e: Omit<MemoryEvent, "id" | "at">) => void;
  clearMemoryLog: () => void;

  /** Why the last project-memory analysis failed (shown in the Explorer). */
  memoryError?: string;
  setMemoryError: (e: string | undefined) => void;
}

export const createMemorySlice: Slice<MemorySlice> = (set, get) => ({
  facts: {},

  loadFacts: async (projectId) => {
    try {
      const rows = await db.listFacts(projectId);
      set((s) => ({ facts: { ...s.facts, [projectId]: rows } }));
      // Say how many arrived. An empty panel has two very different causes
      // — nothing stored, or nothing delivered — and they need telling
      // apart without a debugger.
      get().logMemory({
        kind: "audit",
        status: "ok",
        detail: `facts loaded: ${rows.length}`,
        projectId,
      });
    } catch (e) {
      // Never silent: a swallowed failure here looks exactly like a project
      // that has no memory, and that is indistinguishable from a bug.
      const error = reportError(e, "db:list_facts");
      get().logMemory({
        kind: "audit",
        status: "error",
        detail: `facts: ${error.message.slice(0, 160)}`,
        projectId,
      });
    }
  },

  saveFacts: (rows) => {
    if (!rows.length) return;
    void reportPromise(db.saveFacts(rows), "db:save_facts");
    set((s) => {
      const next = { ...s.facts };
      for (const f of rows) {
        const list = next[f.projectId] ?? [];
        const at = list.findIndex((x) => x.id === f.id);
        next[f.projectId] =
          at < 0 ? [...list, f] : list.map((x) => (x.id === f.id ? f : x));
      }
      return { facts: next };
    });
  },

  deleteFact: (projectId, id) => {
    void reportPromise(db.deleteFact(id), "db:delete_fact");
    set((s) => ({
      facts: {
        ...s.facts,
        [projectId]: (s.facts[projectId] ?? []).filter((x) => x.id !== id),
      },
    }));
    // A queued disagreement about a fact that no longer exists is nothing
    // but noise in the pile — and a pile of noise is a pile nobody opens.
    for (const d of get().divergences[projectId] ?? []) {
      if (d.factId === id && d.status === "open")
        get().saveDivergence({ ...d, status: "dismissed", resolvedAt: now() });
    }
  },

  divergences: {},

  loadDivergences: async (projectId) => {
    try {
      const rows = await db.listDivergences(projectId);
      set((s) => ({ divergences: { ...s.divergences, [projectId]: rows } }));
    } catch (e) {
      const error = reportError(e, "db:list_divergences");
      get().logMemory({
        kind: "audit",
        status: "error",
        detail: `divergences: ${error.message.slice(0, 160)}`,
        projectId,
      });
    }
  },

  saveDivergence: (d) => {
    void reportPromise(db.saveDivergence(d), "db:save_divergence");
    set((s) => {
      const list = s.divergences[d.projectId] ?? [];
      const at = list.findIndex((x) => x.id === d.id);
      return {
        divergences: {
          ...s.divergences,
          [d.projectId]:
            at < 0 ? [d, ...list] : list.map((x) => (x.id === d.id ? d : x)),
        },
      };
    });
  },

  decisions: {},

  loadDecisions: async (projectId) => {
    try {
      const rows = await db.listDecisions(projectId);
      set((s) => ({ decisions: { ...s.decisions, [projectId]: rows } }));
    } catch (e) {
      const error = reportError(e, "db:list_decisions");
      get().logMemory({
        kind: "audit",
        status: "error",
        detail: `decisions: ${error.message.slice(0, 160)}`,
        projectId,
      });
    }
  },

  saveDecision: (d) => {
    void reportPromise(db.saveDecision(d), "db:save_decision");
    set((s) => {
      const list = s.decisions[d.projectId] ?? [];
      const at = list.findIndex((x) => x.id === d.id);
      return {
        decisions: {
          ...s.decisions,
          [d.projectId]:
            at < 0 ? [d, ...list] : list.map((x) => (x.id === d.id ? d : x)),
        },
      };
    });
  },

  deleteDecision: (projectId, id) => {
    void reportPromise(db.deleteDecision(id), "db:delete_decision");
    set((s) => ({
      decisions: {
        ...s.decisions,
        [projectId]: (s.decisions[projectId] ?? []).filter((x) => x.id !== id),
      },
    }));
  },

  proposals: {},

  loadProposals: async (projectId) => {
    try {
      const rows = await db.listProposals(projectId);
      set((s) => ({ proposals: { ...s.proposals, [projectId]: rows } }));
    } catch (e) {
      const error = reportError(e, "db:list_proposals");
      get().logMemory({
        kind: "audit",
        status: "error",
        detail: `proposals: ${error.message.slice(0, 160)}`,
        projectId,
      });
    }
  },

  saveProposal: (p) => {
    void reportPromise(db.saveProposal(p), "db:save_proposal");
    set((s) => {
      const list = s.proposals[p.projectId] ?? [];
      const at = list.findIndex((x) => x.id === p.id);
      return {
        proposals: {
          ...s.proposals,
          [p.projectId]:
            at < 0 ? [p, ...list] : list.map((x) => (x.id === p.id ? p : x)),
        },
      };
    });
  },

  // The log is capped: it is a recent-activity feed, not an archive.
  memoryLog: [],
  logMemory: (e) =>
    set((s) => ({
      memoryLog: [{ ...e, id: uid(), at: Date.now() }, ...s.memoryLog].slice(0, 60),
    })),
  clearMemoryLog: () => set({ memoryLog: [] }),

  setMemoryError: (e) => set({ memoryError: e }),
});
