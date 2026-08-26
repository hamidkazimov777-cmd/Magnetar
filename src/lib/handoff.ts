import { api } from "./api";
import { db } from "./db";
import { useStore } from "./store";
import { buildMemorySection, cheapModel } from "./memory";
import { ensureProjectFacts, newFact, projectFacts } from "./facts";
import { recordDecision } from "./decisions";
import { similarity } from "./relevance";
import { reportError, reportPromise, withRetry } from "./errors";
import type { ChatMessage, Connection, FactKind, Session } from "./types";

/** Keep this many most-recent messages verbatim; older ones get compressed into
 *  the rolling summary. */
const TAIL = 4;
/** Only bother summarizing once the transcript grows past this. */
const SUMMARY_THRESHOLD = 10;

const BASE_SYSTEM = `You are Magnetar, a local coding agent. You may be a different underlying model than the one that wrote earlier turns — the conversation is kept in a provider-neutral canon, so continue seamlessly regardless of which model spoke before. Be concise and precise.

You are currently in plain chat mode: you have NO tools and cannot read files, list folders, search the code, or run commands. If the user asks you to look at their project, files or folders, say plainly that this needs Agent mode and tell them to switch the "Agent" toggle on above the composer — do not pretend you inspected anything.`;

/** Build what actually goes to the provider: a system prompt (identity + handoff
 *  summary + a note when the model just changed) and the message tail. When a
 *  summary exists we send only the tail after it, which keeps token cost down
 *  AND carries context across model switches. */
export async function buildOutgoing(
  session: Session,
  currentModel: string,
): Promise<{ system: string; messages: ChatMessage[] }> {
  const msgs = session.messages;

  let sendFrom = 0;
  const parts: string[] = [BASE_SYSTEM];

  if (session.seesProject !== false && session.projectId) {
    // The same memory the agent is given, rendered by the same function.
    // This used to be a second implementation reading the old prose fields, so
    // asking the same question in Discussion and in Agent produced answers
    // built from different memory — and only the agent's could say where any
    // of it came from.
    //
    // Selected against the last thing the user said, for the same reason the
    // agent selects against the request: sending every fact wastes tokens and
    // buries the two that matter.
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const memory = buildMemorySection(session, lastUser);
    if (memory) parts.push(memory);

    // Knowledge Graph Subgraph
    try {
      const nodes = await db.listKnowledgeNodes(session.projectId!);
      if (nodes.length > 0) {
        // Very basic retrieval: just include nodes whose title appears in recent messages
        const recentText = msgs.slice(-3).map(m => m.content).join(" ").toLowerCase();
        const relevantNodes = nodes.filter(n => recentText.includes(n.title.toLowerCase()));
        
        if (relevantNodes.length > 0) {
          parts.push(`\n## Related Knowledge (Subgraph)`);
          relevantNodes.forEach(n => {
            parts.push(`- **${n.title}** (${n.nodeType}): ${n.summary || "No summary"}`);
          });
        }
      }
    } catch (error) {
      reportError(error, "handoff.graph.retrieve");
    }
  }

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
  defaultConnection: Connection,
  defaultModel: string,
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

  // One shared picker for every background task (memory.ts): it honours the
  // "background model" setting and skips models the provider already refused.
  // This used to be a second, divergent copy of the same heuristic.
  const picked = cheapModel();
  const useConn = picked?.connection ?? defaultConnection;
  const useModel = picked?.model ?? defaultModel;

  try {
    const summary = await withRetry(
      () =>
        api.complete(
          useConn,
          useModel,
          [instruction],
          "You write terse, information-dense engineering handoff notes.",
        ),
      { attempts: 2 },
    );
    if (summary.trim()) {
      setSummary(summary.trim(), upToId);
      useStore.getState().logMemory({ kind: "summary", status: "ok", model: useModel });
    }
  } catch (e) {
    const error = reportError(e, "memory.summary");
    useStore.getState().logMemory({
      kind: "summary",
      status: "error",
      detail: error.message,
      model: useModel,
    });
  }

  // Also try to extract project brain updates if this session belongs to a project.
  if (session.projectId) {
    void reportPromise(
      maybeExtractProjectBrain(transcript, session.projectId, useConn, useModel),
      "memory.projectBrain",
    );
    void reportPromise(
      maybeBuildKnowledgeGraph(transcript, session.projectId, useConn, useModel),
      "memory.knowledgeGraph",
    );
  }
}

/** Mine a finished stretch of conversation for what the project now knows.
 *
 *  This used to append prose to `techStack` / `architectureNotes` /
 *  `codingStandards`, which grew without limit, carried no provenance and could
 *  never be checked — while the folder audit was writing facts about the same
 *  project at the same time. Two writers, two shapes, and the panel showed one
 *  of them.
 *
 *  Now it writes facts and decisions, the same entities as everything else. A
 *  claim a model inferred from a conversation says exactly that, and the
 *  verifier can later confirm or refute it like any other.
 */
async function maybeExtractProjectBrain(
  transcript: string,
  projectId: string,
  conn: Connection,
  model: string,
) {
  const p = useStore.getState().projects.find((x) => x.id === projectId);
  if (!p) return;

  const instruction: ChatMessage = {
    id: "ext",
    role: "user",
    content:
      `From the conversation below, extract only what is NEW and durable about the project ` +
      `— things that will still be true next week. Skip anything that was merely discussed.\n\n` +
      `Return raw JSON, no markdown:\n` +
      `{"facts":[{"kind":"stack|architecture|constraint","text":"one claim, under 200 chars"}],` +
      `"decisions":[{"title":"what was decided","rationale":"why, in one line"}]}\n` +
      `Both keys are optional. Empty is a valid and common answer.\n\n---\n${transcript}`,
    createdAt: 0,
  };

  try {
    const res = await api.complete(
      conn,
      model,
      [instruction],
      "You extract durable project facts and decisions. Always return raw JSON.",
    );

    let parsed: { facts?: unknown; decisions?: unknown } | null = null;
    try {
      parsed = JSON.parse(res.trim().replace(/^```json/, "").replace(/```$/, ""));
    } catch {
      useStore.getState().logMemory({
        kind: "decisions",
        status: "error",
        detail: "memErrParse",
        projectId,
        model,
      });
      return;
    }
    if (!parsed) return;

    await ensureProjectFacts(projectId);
    const existing = projectFacts(projectId);
    const kinds: FactKind[] = ["stack", "architecture", "constraint", "state"];

    const rows = (Array.isArray(parsed.facts) ? parsed.facts : [])
      .map((raw) => raw as Record<string, unknown>)
      .flatMap((f) => {
        const text = typeof f.text === "string" ? f.text.trim() : "";
        if (text.length < 3) return [];
        // A conversation restates what the project already knows constantly.
        // Without this the same fact accumulates a copy per summarisation.
        if (existing.some((e) => similarity(e.text, text) > 0.8)) return [];
        const kind = kinds.includes(f.kind as FactKind) ? (f.kind as FactKind) : "architecture";
        // Inferred, not extracted: a model read a conversation, not a file.
        // No verify spec, because there is no source to check it against.
        return [newFact(projectId, kind, text.slice(0, 400), "inferred", model)];
      });

    if (rows.length) useStore.getState().saveFacts(rows);

    for (const raw of Array.isArray(parsed.decisions) ? parsed.decisions : []) {
      const d = raw as Record<string, unknown>;
      const title = typeof d.title === "string" ? d.title.trim() : "";
      if (title.length < 3) continue;
      await recordDecision(projectId, {
        title: title.slice(0, 200),
        rationale: typeof d.rationale === "string" ? d.rationale.slice(0, 500) : undefined,
        // "agent": a model concluded it from the conversation, as opposed to
        // the user stating it or it being carried over from the old notes.
        origin: "agent",
      });
    }

    useStore.getState().logMemory({
      kind: "decisions",
      status: "ok",
      detail: `facts +${rows.length}`,
      projectId,
      model,
    });
  } catch (e) {
    const error = reportError(e, "memory.projectBrain");
    useStore.getState().logMemory({
      kind: "decisions",
      status: "error",
      detail: error.message,
      projectId,
      model,
    });
  }
}

async function maybeBuildKnowledgeGraph(transcript: string, projectId: string, conn: Connection, model: string) {
  const instruction: ChatMessage = {
    id: "kg",
    role: "user",
    content: `Analyze this conversation transcript and extract key named entities, concepts, or files (Knowledge Nodes) and their relationships (Knowledge Edges).
Format your response as a JSON object with keys: "nodes" (array of {title: string, nodeType: string, summary: string}) and "edges" (array of {source: string, target: string, relation: string}).
Keep the extraction minimal and focused on important architecture, tools, or domain concepts.
\n\n---\n${transcript}`,
    createdAt: 0,
  };

  try {
    const res = await api.complete(conn, model, [instruction], "You are an expert knowledge graph builder. Always return raw JSON.");
    
    let parsed: { nodes?: any[], edges?: any[] } | null = null;
    try {
      parsed = JSON.parse(res.trim().replace(/^```json/, "").replace(/```$/, ""));
    } catch {
      useStore.getState().logMemory({
        kind: "graph",
        status: "error",
        detail: "memErrParse",
        projectId,
        model,
      });
      return;
    }

    if (!parsed) return;

    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      for (const n of parsed.nodes) {
        if (n.title && n.nodeType) {
          // Use the title as the ID for simpler edge mapping
          const id = n.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          await db.saveKnowledgeNode({
            id,
            projectId,
            title: n.title,
            nodeType: n.nodeType,
            summary: n.summary || "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }).catch((error) => reportError(error, "memory.knowledgeNode"));
        }
      }

      if (parsed.edges && Array.isArray(parsed.edges)) {
        for (const e of parsed.edges) {
          if (e.source && e.target && e.relation) {
            const sourceId = e.source.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const targetId = e.target.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            await db.saveKnowledgeEdge({
              source: sourceId,
              target: targetId,
              relation: e.relation,
            }).catch((error) => reportError(error, "memory.knowledgeEdge"));
          }
        }
      }

      if (parsed.nodes.length)
        useStore.getState().logMemory({
          kind: "graph",
          status: "ok",
          detail: String(parsed.nodes.length),
          projectId,
          model,
        });
    }
  } catch (e) {
    const error = reportError(e, "memory.knowledgeGraph");
    useStore.getState().logMemory({
      kind: "graph",
      status: "error",
      detail: error.message,
      projectId,
      model,
    });
  }
}
