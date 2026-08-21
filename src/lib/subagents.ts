import { runAgent, type AgentToolEvent } from "./agent";
import { buildProjectMemory } from "./memory";
import { useStore } from "./store";
import { resolveLeases } from "./leases";
import type { ChatMessage, Connection } from "./types";

/* ==========================================================================
   SUBAGENTS

   A lead agent that splits the work, hands it out, and puts the results back
   together. The helpers are ordinary agent runs with three differences: they
   cannot delegate further, they cannot do anything destructive, and they hand
   back a short report instead of a transcript.

   Three constraints are deliberate and worth defending:

   1. **File leases.** A task declares the files it will touch, and overlapping
      tasks are refused. Two agents editing the same file do not merge — the
      second write wins and the first agent's work vanishes without a trace.

   2. **Reports, not transcripts.** Returning a helper's full dialogue would
      blow up the lead's context by the third helper, and you would pay for the
      same tokens twice. What the lead needs is: what changed, where, what is
      left.

   3. **A shared budget and a concurrency cap.** Eight helpers at forty steps
      each is three hundred and twenty tool calls. Providers rate-limit, memory
      is sent to every one of them, and nobody can follow eight parallel runs
      on screen.
   ========================================================================== */

/** How many helpers actually run at once, regardless of how many were asked
 *  for. The rest queue. */
export const DEFAULT_PARALLEL = 3;
export { resolveLeases };

/** Total tool calls the whole team may spend on one delegation. */
const TEAM_STEP_BUDGET = 120;

export interface SubagentTask {
  title: string;
  instructions: string;
  /** Paths this task is allowed to change. Empty means read-only work. */
  files?: string[];
}

export interface SubagentReport {
  title: string;
  status: "done" | "failed" | "refused" | "stopped";
  /** The helper's own summary of what it did. */
  summary: string;
  /** Files it actually wrote, observed from its tool calls rather than claimed. */
  changed: string[];
  steps: number;
}

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

const SUBAGENT_SYSTEM = `You are a helper agent working on ONE task inside a larger job. A lead agent split the work and gave you this piece.

Rules of your role:
- Do only your task. Do not touch files outside the ones listed for you — another helper is working on them right now, and the last write wins.
- You cannot delegate, and you cannot ask the user anything: nobody is watching your run.
- Destructive actions are refused for helpers: shell commands that delete or kill, edits to secret files. If your task needs one, stop and say so in your report — the lead will handle it.
- Verify your own work when the project makes it cheap (a typecheck, a build, the file you just wrote).

Finish with a report of at most six lines:
- what you did
- which files you changed
- what is left or blocked, if anything
No preamble, no restating the task.`;

/** Run one helper to completion and reduce it to a report. */
async function runOne(
  connection: Connection,
  model: string,
  task: SubagentTask,
  runId: string,
  opts: { cancelled: () => boolean; budget: () => number; spend: (n: number) => void },
): Promise<SubagentReport> {
  const st = useStore.getState();
  const changed = new Set<string>();
  let steps = 0;
  let text = "";

  const fileList = task.files?.length
    ? `\n\nFiles you own for this task (do not go outside them):\n${task.files.map((f) => `- ${f}`).join("\n")}`
    : "\n\nThis task is read-only: report findings, do not change files.";

  const history: ChatMessage[] = [
    { id: uid(), role: "user", content: task.instructions + fileList, createdAt: Date.now() },
  ];

  st.setSubagent(runId, {
    id: runId,
    title: task.title,
    model,
    status: "running",
    startedAt: Date.now(),
    steps: 0,
  });

  try {
    await runAgent(
      connection,
      model,
      history,
      {
        // A helper never blocks: anything needing a human is refused and
        // reported upward. Prompting from three parallel runs at once is how
        // people learn to click "allow" without reading.
        confirm: async () => false,
        declineReason:
          "Helpers may not perform destructive actions. Note it in your report and finish; the lead will decide.",
        onText: (d) => {
          text += d;
        },
        onTool: (e: AgentToolEvent) => {
          if (e.status === "running") {
            steps += 1;
            opts.spend(1);
            useStore.getState().setSubagent(runId, {
              steps,
              tool: e.name,
            });
          }
          if (e.status === "done" && (e.name === "write_file" || e.name === "edit_file")) {
            const p = e.args?.path;
            if (typeof p === "string") changed.add(p);
          }
        },
        cancelled: () => opts.cancelled() || opts.budget() <= 0,
      },
      false,
      // The helper gets the project's memory, selected for its own task rather
      // than for the user's original message.
      buildProjectMemory(undefined, task.instructions) + `\n\n${SUBAGENT_SYSTEM}`,
      { isSubagent: true },
    );

    const status: SubagentReport["status"] = opts.cancelled()
      ? "stopped"
      : opts.budget() <= 0
        ? "refused"
        : "done";
    useStore.getState().setSubagent(runId, {
      status: status === "done" ? "done" : "stopped",
      error: status === "done" ? undefined : status === "refused" ? "budget" : "stopped",
    });
    return {
      title: task.title,
      status,
      summary: text.trim().slice(0, 2000) || "(no report)",
      changed: [...changed],
      steps,
    };
  } catch (e) {
    useStore.getState().setSubagent(runId, { status: "failed", error: String(e).slice(0, 300) });
    return {
      title: task.title,
      status: "failed",
      summary: String(e).slice(0, 400),
      changed: [...changed],
      steps,
    };
  }
}

/** Run a batch of tasks with a concurrency cap, returning one report each. */
export async function runTeam(
  tasks: SubagentTask[],
  opts: {
    /** The bench: one entry per model helpers may run on, in order. Tasks are
     *  dealt round robin, so a bench of three and three parallel helpers puts
     *  every task on a different model. */
    bench: { connection: Connection; model: string }[];
    parallel?: number;
    cancelled: () => boolean;
  },
): Promise<SubagentReport[]> {
  const parallel = Math.max(1, Math.min(opts.parallel ?? DEFAULT_PARALLEL, 5));
  const reports: SubagentReport[] = new Array(tasks.length);

  let remaining = TEAM_STEP_BUDGET;
  const budget = () => remaining;
  const spend = (n: number) => {
    remaining -= n;
  };

  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      if (opts.cancelled()) {
        reports[i] = {
          title: tasks[i].title,
          status: "stopped",
          summary: "Not started — the run was stopped.",
          changed: [],
          steps: 0,
        };
        continue;
      }
      const seat = opts.bench[i % opts.bench.length];
      reports[i] = await runOne(seat.connection, seat.model, tasks[i], uid(), {
        cancelled: opts.cancelled,
        budget,
        spend,
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(parallel, tasks.length) }, worker));
  return reports;
}

/** What the lead sees. Compact on purpose — this text lands in its context. */
export function renderReports(
  reports: SubagentReport[],
  refused: { title: string; reason: string }[],
): string {
  const parts = reports.map((r) => {
    const files = r.changed.length ? `\n  changed: ${r.changed.join(", ")}` : "";
    return `### ${r.title} — ${r.status} (${r.steps} steps)\n${r.summary}${files}`;
  });
  if (refused.length)
    parts.push(
      `### refused before starting\n${refused.map((r) => `- ${r.title}: ${r.reason}`).join("\n")}`,
    );
  parts.push(
    "\nIntegrate these results yourself: check the changed files, fix what does not fit together, and report to the user. Do not re-delegate work that is already done.",
  );
  return parts.join("\n\n");
}
