import { api } from "./api";
import { useStore } from "./store";
import { cheapModel } from "./memory";
import type { ChatMessage, Connection, Session } from "./types";

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

  if (session.projectId) {
    const p = useStore.getState().projects.find((x) => x.id === session.projectId);
    if (p) {
      parts.push(`\n## Project Context: ${p.name}`);
      if (p.description) parts.push(`Description: ${p.description}`);
      if (p.techStack) parts.push(`Tech Stack: ${p.techStack}`);
      if (p.codingStandards) parts.push(`Coding Standards: ${p.codingStandards}`);
      if (p.architectureNotes) parts.push(`Architecture: ${p.architectureNotes}`);
      if (p.decisions) parts.push(`Decisions: ${p.decisions}`);
      if (p.lastState)
        parts.push(
          `\n## Where the previous model stopped (continue from here)\n${p.lastState}`,
        );
    }

    // Knowledge Graph Subgraph
    try {
      const nodes = await import("./db").then(m => m.db.listKnowledgeNodes(session.projectId!));
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
    } catch {
      // Ignore DB errors for graph retrieval
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
    const summary = await api.complete(
      useConn,
      useModel,
      [instruction],
      "You write terse, information-dense engineering handoff notes.",
    );
    if (summary.trim()) {
      setSummary(summary.trim(), upToId);
      useStore.getState().logMemory({ kind: "summary", status: "ok", model: useModel });
    }
  } catch (e) {
    useStore.getState().logMemory({
      kind: "summary",
      status: "error",
      detail: String(e).slice(0, 200),
      model: useModel,
    });
  }

  // Also try to extract project brain updates if this session belongs to a project.
  if (session.projectId) {
    void maybeExtractProjectBrain(transcript, session.projectId, useConn, useModel).catch(() => {});
    void maybeBuildKnowledgeGraph(transcript, session.projectId, useConn, useModel).catch(() => {});
  }
}

async function maybeExtractProjectBrain(transcript: string, projectId: string, conn: Connection, model: string) {
  const p = useStore.getState().projects.find((x) => x.id === projectId);
  if (!p) return;

  const instruction: ChatMessage = {
    id: "ext",
    role: "user",
    content: `Analyze this recent conversation transcript and extract any NEW architectural decisions, tech stack additions, or coding standards that were established.
Format your response as a JSON object (without markdown blocks) with keys: "techStack", "architectureNotes", "codingStandards", "decisions".
If there are no new updates for a category, omit the key or return null. Keep notes terse.
\n\n---\n${transcript}`,
    createdAt: 0,
  };

  try {
    const res = await api.complete(
      conn,
      model,
      [instruction],
      "You are an expert tech lead summarizing architectural decisions. Always return raw JSON.",
    );
    
    // Attempt to parse JSON and update project
    let parsed: any = null;
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

    let updated = false;
    const newP = { ...p };
    
    if (parsed.techStack && !p.techStack?.includes(parsed.techStack)) {
      newP.techStack = p.techStack ? `${p.techStack}\n- ${parsed.techStack}` : `- ${parsed.techStack}`;
      updated = true;
    }
    if (parsed.architectureNotes && !p.architectureNotes?.includes(parsed.architectureNotes)) {
      newP.architectureNotes = p.architectureNotes ? `${p.architectureNotes}\n- ${parsed.architectureNotes}` : `- ${parsed.architectureNotes}`;
      updated = true;
    }
    if (parsed.codingStandards && !p.codingStandards?.includes(parsed.codingStandards)) {
      newP.codingStandards = p.codingStandards ? `${p.codingStandards}\n- ${parsed.codingStandards}` : `- ${parsed.codingStandards}`;
      updated = true;
    }
    if (parsed.decisions && !p.decisions?.includes(parsed.decisions)) {
      newP.decisions = p.decisions ? `${p.decisions}\n- ${parsed.decisions}` : `- ${parsed.decisions}`;
      updated = true;
    }

    if (updated) {
      newP.updatedAt = Date.now();
      useStore.getState().updateProject(newP);
      useStore.getState().logMemory({
        kind: "decisions",
        status: "ok",
        projectId,
        model,
      });
    }
  } catch (e) {
    useStore.getState().logMemory({
      kind: "decisions",
      status: "error",
      detail: String(e).slice(0, 200),
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
      const db = await import("./db").then(m => m.db);
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
          }).catch(() => {});
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
            }).catch(() => {});
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
    useStore.getState().logMemory({
      kind: "graph",
      status: "error",
      detail: String(e).slice(0, 200),
      projectId,
      model,
    });
  }
}
