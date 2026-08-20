import { projectFacts } from "./facts";
import { useStore } from "./store";
import type { Divergence, MemoryFact } from "./types";

/* ==========================================================================
   THE DIVERGENCE QUEUE

   When the code and the memory disagree, the fix is not a dialog. Stopping the
   work to confirm each correction is how confirmation fatigue starts — and
   confirmation fatigue is what made the user turn approvals off entirely and
   then get a `pkill` with no warning. So contradictions pile up, and the human
   goes through the pile when they feel like it.
   ========================================================================== */

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

export async function ensureDivergences(projectId: string): Promise<void> {
  const st = useStore.getState();
  if (!st.divergences[projectId]) await st.loadDivergences(projectId);
}

export function openDivergences(projectId: string | undefined): Divergence[] {
  if (!projectId) return [];
  return (useStore.getState().divergences[projectId] ?? []).filter(
    (d) => d.status === "open",
  );
}

/** Queue one contradiction. Silent by design — nothing pops up, nothing blocks;
 *  the count in the panel is the only thing that moves. */
export function queueDivergence(
  projectId: string,
  d: {
    summary: string;
    factId?: string;
    proposal?: string;
    evidence?: string;
    source?: Divergence["source"];
  },
): Divergence | null {
  const summary = d.summary.trim();
  if (!summary) return null;

  // The same disagreement found on every run should not become fifty entries
  // to click through — that is the pile people stop opening.
  const existing = (useStore.getState().divergences[projectId] ?? []).find(
    (x) =>
      x.status === "open" &&
      (d.factId ? x.factId === d.factId : x.summary === summary),
  );
  if (existing) return existing;

  const row: Divergence = {
    id: uid(),
    projectId,
    factId: d.factId,
    summary,
    proposal: d.proposal?.trim() || undefined,
    evidence: d.evidence?.trim() || undefined,
    source: d.source ?? "agent",
    status: "open",
    createdAt: Date.now(),
  };
  useStore.getState().saveDivergence(row);
  return row;
}

/** Accept the proposal: rewrite the fact it is about, or drop the fact when the
 *  proposal is empty. Applying is the only path that changes memory — reviewing
 *  the queue is a deliberate act, which is the point. */
export function applyDivergence(d: Divergence): void {
  const st = useStore.getState();
  const fact = d.factId
    ? projectFacts(d.projectId).find((f) => f.id === d.factId)
    : undefined;

  if (fact) {
    if (!d.proposal) {
      st.deleteFact(d.projectId, fact.id);
    } else {
      const next: MemoryFact = {
        ...fact,
        text: d.proposal,
        // The correction came from looking at the code, but nothing has
        // re-run a check against the new wording yet.
        origin: d.source === "check" ? "extracted" : "inferred",
        originDetail: d.evidence ?? fact.originDetail,
        status: "unverified",
        checkedAt: undefined,
        updatedAt: Date.now(),
      };
      st.saveFacts([next]);
    }
  }

  st.saveDivergence({ ...d, status: "applied", resolvedAt: Date.now() });
}

export function dismissDivergence(d: Divergence): void {
  useStore
    .getState()
    .saveDivergence({ ...d, status: "dismissed", resolvedAt: Date.now() });
}
