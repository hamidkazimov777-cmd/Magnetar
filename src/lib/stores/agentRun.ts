import type { AgentToolEvent } from "../agent";
import type { SubagentRun } from "../types";
import { now, uid, type FileChange } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   A RUN IN FLIGHT

   Process, not canon: none of this survives a restart, and none of it is
   persisted. It lives in the store rather than in React state because several
   places start runs — composer, command palette, a queued prompt — and a
   local flag let them race, leaving several runs going at once, each
   answering nobody.
   ========================================================================== */

export interface AgentRunSlice {
  /** Agent file mutations awaiting review. */
  changes: FileChange[];
  addChange: (c: Omit<FileChange, "id" | "at">) => void;
  markReverted: (id: string) => void;
  clearChanges: () => void;

  /** The shell command (or other tool) running right now, if any. The composer
   *  uses it to offer "interrupt and deliver my message": while a command is
   *  running the agent loop is blocked awaiting it, so a queued message would
   *  not be read until it finishes — which is useless when it has hung. */
  runningTool?: { name: string; startedAt: number };
  setRunningTool: (t: { name: string; startedAt: number } | undefined) => void;

  /** True while an agent run is in flight. */
  agentRunning: boolean;
  /** When the current run started — the activity indicator counts from here,
   *  and a run with no visible sign of life reads as a hang. */
  agentRunStartedAt?: number;
  setAgentRunning: (v: boolean) => void;

  /** Helper agents currently running, keyed by run id. */
  subagents: Record<string, SubagentRun>;
  setSubagent: (
    id: string,
    patch: (Partial<SubagentRun> & Pick<SubagentRun, "id">) | Partial<SubagentRun>,
  ) => void;
  clearSubagents: () => void;
  /** Ask one helper to stop; it ends at its next step boundary. */
  stopSubagent: (id: string) => void;
  /** Ask every running helper to stop. */
  stopAllSubagents: () => void;

  /** What the user typed while an agent run was in flight. The run folds these
   *  in before its next model call, so a long run can be steered or questioned
   *  instead of ignoring the user until it finishes. */
  agentInterjections: string[];
  pushAgentInterjection: (text: string) => void;
  clearAgentInterjections: () => void;

  agentTrace: Record<string, AgentToolEvent[]>;
  pushAgentEvent: (messageId: string, e: AgentToolEvent) => void;
  clearAgentTrace: (messageId: string) => void;

  /** Last request error, shown as a retryable banner in the chat. */
  lastError?: { message: string; sessionId: string };
  setLastError: (e: { message: string; sessionId: string } | undefined) => void;

  /** Exactly what was sent to the model as context on the last turn, so the
   *  user can inspect it instead of guessing where an answer came from. */
  lastContext?: { system: string; model: string; at: number };
  setLastContext: (c: { system: string; model: string; at: number }) => void;

  /** Set when the user approves shell commands for the rest of this session,
   *  so a long build does not ask on every single command. Never persisted. */
  trustCommands: boolean;
  setTrustCommands: (v: boolean) => void;

  /** One-shot text handed to the agent composer (e.g. "Run audit" → /cto). */
  pendingPrompt?: string;
  requestPrompt: (text: string) => void;
  consumePrompt: () => string | undefined;

  /** Text sent to the Studio tab by the prompt builder. */
  pendingStudioPrompt?: string;
  requestStudioPrompt: (text: string) => void;
  consumeStudioPrompt: () => string | undefined;
}

export const createAgentRunSlice: Slice<AgentRunSlice> = (set, get) => ({
  changes: [],
  addChange: (c) =>
    set((s) => ({
      changes: [...s.changes, { ...c, id: uid(), at: Date.now() }],
    })),
  markReverted: (id) =>
    set((s) => ({
      changes: s.changes.map((c) => (c.id === id ? { ...c, reverted: true } : c)),
    })),
  clearChanges: () => set({ changes: [] }),

  runningTool: undefined,
  setRunningTool: (runningTool) => set({ runningTool }),

  agentRunning: false,
  setAgentRunning: (v) =>
    set({ agentRunning: v, agentRunStartedAt: v ? now() : undefined }),

  subagents: {},
  setSubagent: (id, patch) =>
    set((s) => {
      const prev = s.subagents[id];
      const next = { ...(prev ?? {}), ...patch, id } as SubagentRun;
      return { subagents: { ...s.subagents, [id]: next } };
    }),
  clearSubagents: () => set({ subagents: {} }),

  stopSubagent: (id) =>
    set((s) => {
      const run = s.subagents[id];
      if (!run) return {};
      return { subagents: { ...s.subagents, [id]: { ...run, cancelRequested: true } } };
    }),

  stopAllSubagents: () =>
    set((s) => ({
      subagents: Object.fromEntries(
        Object.entries(s.subagents).map(([k, v]) => [
          k,
          v.status === "running" ? { ...v, cancelRequested: true } : v,
        ]),
      ),
    })),

  agentInterjections: [],
  pushAgentInterjection: (text) =>
    set((s) => ({ agentInterjections: [...s.agentInterjections, text] })),
  clearAgentInterjections: () => set({ agentInterjections: [] }),

  agentTrace: {},
  pushAgentEvent: (messageId, e) =>
    set((s) => {
      const prev = s.agentTrace[messageId] ?? [];
      // A second event for the same call id replaces the running placeholder.
      const idx = prev.findIndex((x) => x.id === e.id);
      const next = idx >= 0 ? prev.map((x, i) => (i === idx ? e : x)) : [...prev, e];
      return { agentTrace: { ...s.agentTrace, [messageId]: next } };
    }),
  clearAgentTrace: (messageId) =>
    set((s) => {
      const { [messageId]: _drop, ...rest } = s.agentTrace;
      return { agentTrace: rest };
    }),

  setLastError: (e) => set({ lastError: e }),

  setLastContext: (c) => set({ lastContext: c }),

  trustCommands: false,
  setTrustCommands: (v) => set({ trustCommands: v }),

  requestPrompt: (text) => set({ pendingPrompt: text, agentPanelOpen: true }),
  consumePrompt: () => {
    const p = get().pendingPrompt;
    if (p) set({ pendingPrompt: undefined });
    return p;
  },

  requestStudioPrompt: (text) => set({ pendingStudioPrompt: text, activeTrack: "generation", centerView: "studio" }),
  consumeStudioPrompt: () => {
    const p = get().pendingStudioPrompt;
    if (p) set({ pendingStudioPrompt: undefined });
    return p;
  },
});
