import { api } from "./api";
import type { ChatMessage, Connection, Session } from "./types";

/** Keep this many most-recent messages verbatim; older ones get compressed into
 *  the rolling summary. */
const TAIL = 4;
/** Only bother summarizing once the transcript grows past this. */
const SUMMARY_THRESHOLD = 10;

const BASE_SYSTEM = `You are Magnetar, a local coding agent. You may be a different underlying model than the one that wrote earlier turns — the conversation is kept in a provider-neutral canon, so continue seamlessly regardless of which model spoke before. Be concise and precise.`;

/** Build what actually goes to the provider: a system prompt (identity + handoff
 *  summary + a note when the model just changed) and the message tail. When a
 *  summary exists we send only the tail after it, which keeps token cost down
 *  AND carries context across model switches. */
export function buildOutgoing(
  session: Session,
  currentModel: string,
): { system: string; messages: ChatMessage[] } {
  const msgs = session.messages;

  let sendFrom = 0;
  const parts: string[] = [BASE_SYSTEM];

  if (session.summary && session.summaryUpToId) {
    const idx = msgs.findIndex((m) => m.id === session.summaryUpToId);
    if (idx >= 0) {
      sendFrom = idx + 1;
      parts.push(
        `\n## Conversation so far (handoff summary)\n${session.summary}`,
      );
    }
  }

  // Continuity note when the previous assistant turn came from another model.
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant" && m.content);
  if (lastAssistant?.model && lastAssistant.model !== currentModel) {
    parts.push(
      `\n(Note: earlier assistant turns were produced by "${lastAssistant.model}". You are now "${currentModel}". Pick up exactly where that left off.)`,
    );
  }

  return { system: parts.join("\n"), messages: msgs.slice(sendFrom) };
}

/** Refresh the rolling summary when the transcript has grown. Uses a cheap,
 *  single-shot completion on the given connection/model. Best-effort: failures
 *  are swallowed so chat never breaks because summarization hiccuped. */
export async function maybeSummarize(
  session: Session,
  connection: Connection,
  model: string,
  setSummary: (summary: string, upToId: string) => void,
): Promise<void> {
  const msgs = session.messages.filter((m) => m.content);
  if (msgs.length < SUMMARY_THRESHOLD) return;

  const cutoff = msgs.length - TAIL;
  if (cutoff <= 0) return;
  const upToId = msgs[cutoff - 1].id;
  if (session.summaryUpToId === upToId) return; // already current

  const transcript = msgs
    .slice(0, cutoff)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const instruction: ChatMessage = {
    id: "sum",
    role: "user",
    content:
      `Summarize the conversation below into a compact handoff note another AI model can use to continue the work with zero context loss. Capture: goal, decisions made, current state, open questions, and any file paths or code identifiers. Bullet points, no preamble.\n\n---\n${transcript}`,
    createdAt: 0,
  };

  try {
    const summary = await api.complete(
      connection,
      model,
      [instruction],
      "You write terse, information-dense engineering handoff notes.",
    );
    if (summary.trim()) setSummary(summary.trim(), upToId);
  } catch {
    // ignore — non-critical
  }
}
