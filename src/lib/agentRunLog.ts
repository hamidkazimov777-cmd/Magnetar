import { db, type AgentRunRow } from "./db";
import { uid } from "./stores/shared";
import type { AgentHandlers } from "./agent";

/* ==========================================================================
   DURABLE RUN LOG

   The agent loop lives in the frontend, and the store copy of a run does not
   survive a restart. This wraps the run at the handler boundary — without
   touching the loop — and writes the canonical record to SQLite: one
   `agent_runs` row and an append-only `agent_events` trace.

   Every write is fire-and-forget. Persistence must never be able to break a
   run: in the web preview there is no Tauri backend at all, and a failed write
   there (or anywhere) is swallowed, not thrown.

   Text deltas are deliberately NOT logged here — the assistant's prose is
   already canon in the messages table. The trace records tool activity and
   per-turn usage, which is what resume, budgets and review need.
   ========================================================================== */

export interface RunLogMeta {
  sessionId: string | null;
  projectId: string | null;
  connectionId: string | null;
  model: string | null;
  budgetSteps?: number | null;
  budgetUsd?: number | null;
  /** Token ceiling (input + output). 0 or null disables it. */
  budgetTokens?: number | null;
}

export interface RunLog {
  runId: string;
  /** Decorate the caller's handlers so tool and usage events are persisted and
   *  the token budget is enforced between steps. */
  wrap(h: AgentHandlers): AgentHandlers;
  /** True once the token budget stopped the run — so the caller can record the
   *  outcome as a budget stop rather than a plain finish. */
  budgetHit(): boolean;
  /** Close the run with its final status. */
  finish(status: AgentRunRow["status"], error?: string | null): Promise<void>;
}

export function beginRunLog(meta: RunLogMeta): RunLog {
  const runId = uid();
  const startedAt = Date.now();
  const run: AgentRunRow = {
    id: runId,
    sessionId: meta.sessionId,
    projectId: meta.projectId,
    connectionId: meta.connectionId,
    model: meta.model,
    status: "running",
    startedAt,
    updatedAt: startedAt,
    endedAt: null,
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    budgetSteps: meta.budgetSteps ?? null,
    budgetUsd: meta.budgetUsd ?? null,
    error: null,
  };
  const tokenCeiling = meta.budgetTokens ?? 0;
  let budgetStopped = false;

  const save = () => {
    void db.saveAgentRun({ ...run }).catch(() => {});
  };
  const event = (kind: import("./db").AgentEventRow["kind"], payload: unknown) => {
    void db
      .appendAgentEvent(runId, uid(), kind, payload == null ? null : JSON.stringify(payload), Date.now())
      .catch(() => {});
  };

  save();

  return {
    runId,
    wrap(h) {
      return {
        ...h,
        onTool: (e) => {
          if (e.status === "running") {
            event("tool_call", { id: e.id, name: e.name, args: e.args });
          } else {
            event("tool_result", {
              id: e.id,
              name: e.name,
              status: e.status,
              result: e.result,
              durationMs: e.durationMs,
            });
          }
          h.onTool?.(e);
        },
        onUsage: (u) => {
          run.tokensIn += u.inputTokens ?? 0;
          run.tokensOut += u.outputTokens ?? 0;
          run.steps += 1;
          run.updatedAt = Date.now();
          event("model_turn", { inputTokens: u.inputTokens, outputTokens: u.outputTokens });
          save();
          h.onUsage?.(u);
        },
        overBudget: () => {
          if (tokenCeiling > 0 && run.tokensIn + run.tokensOut >= tokenCeiling) {
            const spent = run.tokensIn + run.tokensOut;
            const reason = `Token budget reached (${spent} ≥ ${tokenCeiling} tokens). Stopping the run — raise the limit in Settings to continue.`;
            if (!budgetStopped) {
              budgetStopped = true;
              run.error = reason;
              event("error", { budget: "tokens", reason });
            }
            return reason;
          }
          return h.overBudget?.() ?? null;
        },
      };
    },
    budgetHit: () => budgetStopped,
    finish(status, error) {
      run.status = status;
      // Only overwrite the reason when the caller supplies one — a budget stop
      // already recorded its explanation, and finishing must not erase it.
      if (error !== undefined) run.error = error;
      run.endedAt = Date.now();
      run.updatedAt = run.endedAt;
      if (status === "error" && error) event("error", { error });
      return db.saveAgentRun({ ...run }).catch(() => {});
    },
  };
}
