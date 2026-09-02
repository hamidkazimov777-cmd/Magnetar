import { api } from "./api";
import { projectDecisions, renderDecisions } from "./decisions";
import { newFact, projectFacts, renderFacts } from "./facts";
import { cheapModel } from "./memory";
import { useStore } from "./store";
import type { Proposal } from "./types";

/* ==========================================================================
   PROPOSALS

   A model marks a message with `<proposal>…</proposal>`. The user then either
   folds it into project memory (a fact + a Proposal record, then an agent
   reviews it in the background) or rejects it. The record is also the "already
   handled" marker, so the buttons do not reappear.
   ========================================================================== */

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** Extract the inner text of a `<proposal>…</proposal>` marker, or null. */
export function extractProposal(content: string): string | null {
  const m = content.match(/<proposal>([\s\S]*?)<\/proposal>/i);
  return m ? m[1].trim() : null;
}

/** Remove the `<proposal>`/`</proposal>` wrappers but keep the inner text, so
 *  the marker does not leak into the rendered markdown. */
export function stripProposalTags(content: string): string {
  return content.replace(/<\/?proposal>/gi, "");
}

/** Load the open project's proposal records so the buttons know what is
 *  already handled. Called on project open, like the other memory loaders. */
export async function ensureProposals(projectId: string): Promise<void> {
  const st = useStore.getState();
  if (!st.proposals[projectId]) await st.loadProposals(projectId);
}

/** The already-handled record for a message, if any. */
function existing(messageId: string, projectId: string): Proposal | undefined {
  return (useStore.getState().proposals[projectId] ?? []).find(
    (p) => p.messageId === messageId,
  );
}

/** Fold a proposal into project memory and ask an agent to review it. */
export function acceptProposal(
  messageId: string,
  text: string,
  projectId: string,
): void {
  const st = useStore.getState();
  if (!text.trim() || existing(messageId, projectId)) return;

  // Save as an architecture fact: nothing is born verified, and "user" is the
  // honest origin — the human chose to put this into memory.
  const fact = newFact(projectId, "architecture", text, "user", "proposal");
  st.saveFacts([fact]);

  const row: Proposal = {
    id: uid(),
    projectId,
    messageId,
    text,
    status: "accepted",
    createdAt: Date.now(),
  };
  st.saveProposal(row);
  st.logMemory({
    kind: "decisions",
    status: "ok",
    detail: `proposal: ${text.slice(0, 80)}`,
    projectId,
  });

  void reviewProposal(row);
}

/** Reject a proposal. The record exists so the buttons stay gone. */
export function rejectProposal(
  messageId: string,
  text: string,
  projectId: string,
): void {
  if (existing(messageId, projectId)) return;
  const row: Proposal = {
    id: uid(),
    projectId,
    messageId,
    text,
    status: "rejected",
    createdAt: Date.now(),
  };
  useStore.getState().saveProposal(row);
}

/** Background agent review of an accepted proposal. Best-effort: the verdict is
 *  advisory and lands in the record's `review` field; failures are logged and
 *  never break the chat. */
async function reviewProposal(p: Proposal): Promise<void> {
  const st = useStore.getState();
  const picked = cheapModel();
  if (!picked) return;

  const context = [renderFacts(projectFacts(p.projectId)), renderDecisions(projectDecisions(p.projectId), 6)]
    .filter(Boolean)
    .join("\n");

  const system =
    `You are reviewing a proposal the user just accepted into project memory. ` +
    `Say whether it fits the project or conflicts with it, and why, in 1-3 sentences.` +
    (context ? `\n\nCurrent project memory:\n${context}` : ``);

  try {
    const verdict = await api.complete(
      picked.connection,
      picked.model,
      [{ id: uid(), role: "user", content: `Proposal:\n${p.text}`, createdAt: Date.now() }],
      system,
    );
    st.saveProposal({ ...p, review: verdict.trim(), reviewedAt: Date.now() });
  } catch (e) {
    st.logMemory({
      kind: "decisions",
      status: "error",
      detail: `proposal review: ${String(e).slice(0, 160)}`,
      projectId: p.projectId,
    });
  }
}
