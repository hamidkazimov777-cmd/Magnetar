import { api, type ToolDef } from "./api";
import { useStore } from "./store";
import { recordDecision } from "./decisions";
import { queueDivergence } from "./divergence";
import { projectFacts } from "./facts";
import { alwaysConfirm, checkLoop, newLoopWatch } from "./guards";
import { tr } from "./i18n";
import type { ChatMessage, Connection } from "./types";

/** Tools exposed to the model (OpenAI function schemas). */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a text file. Pass offset+limit (1-based line, line count) to read only a slice — prefer this for large files to save tokens.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path" },
        offset: { type: "integer", description: "1-based start line (optional)" },
        limit: { type: "integer", description: "number of lines (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Case-insensitive recursive substring search under a path.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Directory to search (default .)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_code",
    description:
      "Semantic-ish ranked search over the open project (BM25). Best way to find where something lives — returns the most relevant files with a snippet.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for (natural words or identifiers)" },
      },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace a unique old_string with new_string in a file (surgical edit).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "run_bash",
    description: "Run a bash command and return stdout/stderr/exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Working directory (optional)" },
      },
      required: ["command"],
    },
  },
  {
    name: "ask_decision",
    description:
      "Ask the user to settle a notable choice before you build on it — which library, which data schema, which approach. Use it when the choice would be expensive to reverse and the project's memory does not already answer it; do NOT use it for ordinary steps you can just take. The answer is recorded in the project's decision log, with your question as the context, so it survives this conversation.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The choice, in one sentence" },
        options: {
          type: "array",
          description: "The options you are weighing (optional)",
          items: { type: "string" },
        },
        recommendation: { type: "string", description: "What you would pick, and why (optional)" },
      },
      required: ["question"],
    },
  },
  {
    name: "flag_memory",
    description:
      "Report that the project's memory contradicts what you just saw in the code. Does not interrupt anyone: the note is queued for the user to review later, and you keep working. Use it whenever a remembered fact turns out to be wrong or out of date — do not silently work around it, and do not stop to ask.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What memory says versus what the code shows" },
        proposal: { type: "string", description: "What the fact should say instead; omit to suggest dropping it" },
        evidence: { type: "string", description: "Where you saw it: path, line, or a short quote" },
      },
      required: ["summary"],
    },
  },
  {
    name: "attach_file",
    description: "Attach a file from the local filesystem to the chat so the user can view or save it. Use this to send generated images, documents, or data to the user.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to attach" },
      },
      required: ["path"],
    },
  },
];

/** Tools that change the machine. Whether each one blocks on a confirm dialog
 *  is decided by `needsConfirm` — file edits can be auto-applied and reviewed
 *  afterwards (VS Code/Antigravity behaviour), shell commands normally cannot. */
export const DESTRUCTIVE = new Set(["write_file", "edit_file", "run_bash"]);

/** True when this call must stop and ask the user before running. */
export function needsConfirm(name: string, args: ToolArgs = {}): boolean {
  // Some calls are destructive in a way no preference should wave through:
  // overwriting a .env, `rm -rf`, `pkill`. Auto-apply is meant for routine
  // edits, not for losing a credential the user cannot regenerate.
  if (alwaysConfirm(name, args)) return true;
  if (!DESTRUCTIVE.has(name)) return false;
  const st = useStore.getState();
  // Once the user trusts commands for this run, stop interrupting the build.
  if (name === "run_bash") return st.prefs.confirmBash && !st.trustCommands;
  return !st.prefs.autoApplyEdits;
}

export const AGENT_SYSTEM = `You are Magnetar, a local coding agent working inside the user's project. You have tools that read and change their machine.

A project folder is already open — its absolute path is given below as
"Workspace root". You can read and change those files right now with your tools.
Never tell the user you cannot see their files or ask them to paste code: look
with list_dir / search_code / read_file instead.

How to work:
- Finish the job. Keep using tools until the task is actually done — do not stop to ask permission for ordinary steps, and do not hand back a plan when you were asked to build something.
- Ground yourself first: use search_code or list_dir to find real paths. Never invent file paths or APIs.
- Starting from an empty folder is normal: scaffold the project yourself (create files, run the init/install commands you need).
- Prefer surgical edit_file over rewriting whole files. Read a file before editing it.
- Verify your work: after meaningful changes run the project's own build, typecheck or tests when they exist, and fix what fails before reporting success.
- If a command fails, read the error and fix the cause instead of repeating the same command.
- Long-running processes (servers, bots, watchers) never exit, so never run them in the foreground. Detach them completely — redirect ALL three streams: \`npm run dev > /tmp/dev.log 2>&1 < /dev/null &\`. Leaving stdout attached keeps the pipe open after the shell exits and the call appears to hang for minutes. Then wait a moment, read the log, and report what it says.
- Speak while you work. Before a group of tool calls, say in one short line what you are about to do ("checking the logs", "fixing the config"); after they run, say in one line what you found. The user watches this live — a dozen silent calls in a row reads as a hang, not as focus. Do not re-describe the trace in detail, and do not pad.
- If the user writes to you mid-run, answer them on your very next turn before continuing.
- Project memory can be out of date. If a remembered fact contradicts what the code actually shows, believe the code, call flag_memory once with what you saw, and keep going — it queues a note for the user and never blocks you.
- When you are about to make a choice that is expensive to reverse — a library, a data schema, an approach — and memory does not already settle it, call ask_decision with your options and your recommendation. One short question at the moment of choosing beats a rewrite later. Ordinary steps do not need permission.

When the task is complete, end with:
## Handoff Note
- **Status:** what now works (and what you verified)
- **Decisions:** key technical choices
- **Next Steps:** what remains, if anything`;

/** Pull anything the user typed while the agent was working. Draining it here
 *  (rather than starting a second run) is what lets a long run be steered:
 *  the message becomes an ordinary user turn before the next model call. */
function takeInterjections(): string[] {
  const st = useStore.getState();
  const queued = st.agentInterjections;
  if (queued.length === 0) return [];
  st.clearAgentInterjections();
  return queued;
}

/** Fallback when prefs are unavailable; the real budget lives in Prefs. */
const MAX_ITERS = 40;

const stepBudget = () => useStore.getState().prefs?.agentMaxSteps ?? MAX_ITERS;

export type ToolArgs = Record<string, unknown>;

/** Resolve a path the model gave us against the open project.
 *  Models routinely pass "/", ".", or a repo-relative path meaning "the project
 *  root" — taking those literally would list the filesystem root instead. */
function resolvePath(raw: unknown): string {
  const root = useStore.getState().workspaceRoot;
  const p = String(raw ?? "").trim();
  if (!root) return p || ".";
  if (!p || p === "." || p === "/" || p === "./") return root;
  if (p.startsWith("/")) {
    // Absolute but outside the project usually means the model prefixed "/"
    // to a repo-relative path; keep real absolute paths inside the project.
    return p.startsWith(root) ? p : `${root}${p}`;
  }
  return `${root}/${p.replace(/^\.\//, "")}`;
}

/** What `ask_decision` needs from the UI. */
export interface AskRequest {
  question: string;
  options: string[];
  recommendation?: string;
}

/** The live question channel, installed by `runAgent` for the duration of a
 *  run. `executeTool` is a plain function shared by both loops (native and
 *  ReAct), so the bridge lives here rather than being threaded through every
 *  call site. */
let askUser: ((r: AskRequest) => Promise<string>) | null = null;

/** Execute one tool and return a compact string result for the model. */
export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const r = await api.toolReadFile(
          resolvePath(args.path),
          args.offset != null ? Number(args.offset) : undefined,
          args.limit != null ? Number(args.limit) : undefined,
        );
        return r.truncated ? `${r.content}\n[truncated, ${r.bytes} bytes total]` : r.content;
      }
      case "list_dir": {
        const r = await api.toolListDir(resolvePath(args.path));
        return r.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n") || "(empty)";
      }
      case "grep": {
        const r = await api.toolGrep(
          String(args.pattern),
          resolvePath(args.path ?? "."),
        );
        return r.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n") || "(no matches)";
      }
      case "search_code": {
        const root = useStore.getState().workspaceRoot;
        if (!root) return "No project folder is open. Ask the user to open one from the Explorer panel.";
        const r = await api.indexSearch(root, String(args.query), 8);
        return (
          r
            .map((h) => `${h.file}:${h.line}  ${h.snippet}`)
            .join("\n") || "(no matches)"
        );
      }
      case "write_file": {
        const path = resolvePath(args.path);
        const content = String(args.content);
        // Snapshot first — null means the agent is creating a new file.
        const before = await api.editorReadFile(path).catch(() => null);
        const n = await api.toolWriteFile(path, content);
        useStore.getState().addChange({
          path,
          before,
          after: content,
          tool: "write_file",
        });
        return `wrote ${n} bytes to ${path}`;
      }
      case "edit_file": {
        const path = resolvePath(args.path);
        const before = await api.editorReadFile(path).catch(() => null);
        const r = await api.toolEditFile(
          path,
          String(args.old_string),
          String(args.new_string),
        );
        const after = await api.editorReadFile(path).catch(() => "");
        useStore.getState().addChange({ path, before, after, tool: "edit_file" });
        return `edited ${path} (1 replacement)\n${r.diff}`;
      }
      case "run_bash": {
        const r = await api.toolRunBash(
          String(args.command),
          args.cwd ? String(args.cwd) : useStore.getState().workspaceRoot,
          useStore.getState().prefs.bashTimeoutSecs,
        );
        return `exit ${r.code}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`;
      }
      case "ask_decision": {
        const question = String(args.question ?? "").trim();
        if (!question) return "error: question is required";
        const options = Array.isArray(args.options)
          ? args.options.map((o) => String(o)).filter(Boolean)
          : [];
        if (!askUser)
          // No UI is listening (a headless run). Saying so is better than
          // pretending the user answered.
          return "No one is available to answer. Decide yourself, state the assumption, and continue.";

        const answer = (
          await askUser({
            question,
            options,
            recommendation: args.recommendation ? String(args.recommendation) : undefined,
          })
        ).trim();
        if (!answer) return "The user did not answer. Decide yourself, state the assumption, and continue.";

        // The answer is the decision. Recording it here — not asking the model
        // to remember to write it down — is what makes memory grow out of the
        // work instead of out of good intentions.
        const projectId = useStore.getState().activeProjectId;
        if (projectId)
          await recordDecision(projectId, {
            title: answer.length < 120 ? `${question} → ${answer}` : question,
            rationale: answer,
            alternatives: options.filter((o) => o !== answer).join("; ") || undefined,
            origin: "agent",
          });
        return `The user answered: ${answer}`;
      }
      case "flag_memory": {
        const projectId = useStore.getState().activeProjectId;
        if (!projectId) return "No project is open, so there is no memory to correct.";
        const summary = String(args.summary ?? "").trim();
        if (!summary) return "error: summary is required";

        // Attach it to the fact it contradicts when one is recognisable, so
        // accepting the note can rewrite that fact rather than leaving the
        // user to find it.
        const evidence = args.evidence ? String(args.evidence) : undefined;
        const hay = `${summary} ${args.proposal ?? ""}`.toLowerCase();
        const fact = projectFacts(projectId).find(
          (f) => f.text.length > 12 && hay.includes(f.text.toLowerCase().slice(0, 40)),
        );
        queueDivergence(projectId, {
          summary,
          factId: fact?.id,
          proposal: args.proposal ? String(args.proposal) : undefined,
          evidence,
          source: "agent",
        });
        return "Noted for the user to review. Carry on with the task — trust the code, not the memory, for this one.";
      }
      case "attach_file": {
        const result = await api.toolAttachFile(resolvePath(args.path));
        return result;
      }
      default:
        return `unknown tool: ${name}`;
    }
  } catch (e) {
    return `error: ${String(e)}`;
  }
}

/** One tool invocation, surfaced to the UI so the run reads as a sequence of
 *  steps rather than a wall of text. Emitted twice: on start and on finish. */
export interface AgentToolEvent {
  id: string;
  name: string;
  args: ToolArgs;
  status: "running" | "done" | "error" | "declined" | "killed";
  /** When the call started, so the UI can show a live timer on a long command. */
  startedAt?: number;
  /** How long it ran, once finished. */
  durationMs?: number;
  /** Short preview of the tool output (already truncated for display). */
  result?: string;
  /** ReAct providers expose the model's reasoning for the step. */
  thought?: string;
}

export interface AgentHandlers {
  /** Ask the user to approve a destructive tool call. */
  confirm: (name: string, args: ToolArgs) => Promise<boolean>;
  /** Put a decision to the user mid-run. The answer becomes a decision entry.
   *  Absent means nobody is watching, and the agent is told to decide itself. */
  ask?: (r: AskRequest) => Promise<string>;
  /** Append visible assistant prose to the chat. */
  onText: (text: string) => void;
  /** Report a tool step starting/finishing (structured, rendered as a card). */
  onTool?: (e: AgentToolEvent) => void;
  /** Announce a named phase of a multi-role run (Architect/Developer/Reviewer). */
  onPhase?: (label: string, running: boolean) => void;
  /** Stream the model's thinking, when it exposes any. */
  onReasoning?: (text: string) => void;
  /** Token counts for the turn, as the provider reports them. */
  onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void;
  /** Hand the caller a way to abort the in-flight request, not just the loop.
   *  Without this, Stop only takes effect between steps — the current turn
   *  keeps generating (and billing) to the end. */
  setStop?: (stop: () => void) => void;
  /** Returns true when the user pressed Stop — the loop halts between steps. */
  cancelled?: () => boolean;
}

/** Keep tool previews small — the full result still goes to the model. */
const PREVIEW_CAP = 600;
const preview = (s: string) =>
  s.length > PREVIEW_CAP ? `${s.slice(0, PREVIEW_CAP)}…` : s;

/** Convert canon messages to OpenAI wire messages. */
function toWire(messages: ChatMessage[]): unknown[] {
  return messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Dispatch: providers with native function-calling use the tools loop;
 *  everyone else (GigaChat, custom) uses the text-based ReAct loop. */
export async function runAgent(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
  isTeam = false,
  projectMemory = "",
): Promise<void> {
  const system = AGENT_SYSTEM + projectMemory;
  // Open the question channel for the length of the run, and close it after —
  // a stale bridge would let a finished run put a dialog on screen.
  askUser = h.ask ?? null;
  try {
    return await dispatchAgent(connection, model, history, h, system, isTeam);
  } finally {
    askUser = null;
  }
}

async function dispatchAgent(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
  system: string,
  isTeam: boolean,
): Promise<void> {
  if (isTeam) {
    return runTeamAgent(connection, model, history, h, system);
  }
  // Providers accept `tools` even for models that ignore them, so the choice
  // cannot be made from connection.kind alone — we remember what actually
  // happened the first time and fall back to text-based ReAct when needed.
  const mode = useStore.getState().modelTools[`${connection.id}::${model}`];
  const canUseNativeTools =
    connection.kind === "openai_compat" || connection.kind === "anthropic";
  if (canUseNativeTools && mode !== "react") {
    return runAgentNative(connection, model, history, h, system);
  }
  return runAgentReAct(connection, model, history, h, system);
}

export async function runTeamAgent(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
  system: string = AGENT_SYSTEM,
): Promise<void> {
  if (h.cancelled?.()) return;

  h.onPhase?.(tr("agentArchitect"), true);
  h.onText(`**${tr("agentArchitect")}** — ${tr("agentArchitectRunning")}\n\n`);
  const architectSystem =
    "You are the Architect. Analyze the user request, break it down into a clear technical plan with steps. Do not execute code. Just output the plan." +
    system;
  const plan = await api.complete(connection, model, history, architectSystem);

  if (h.cancelled?.()) return;
  h.onText(
    `${plan}\n\n---\n\n**${tr("agentDeveloper")}** — ${tr("agentDeveloperRunning")}\n\n`,
  );

  const devHistory = [...history, { id: "plan", role: "assistant", content: plan, createdAt: 0 }];
  // Run developer with the same project memory in context.
  if (connection.kind === "openai_compat" || connection.kind === "anthropic") {
    await runAgentNative(connection, model, devHistory as ChatMessage[], h, system);
  } else {
    await runAgentReAct(connection, model, devHistory as ChatMessage[], h, system);
  }

  if (h.cancelled?.()) return;
  h.onText(
    `\n\n---\n\n**${tr("agentReviewer")}** — ${tr("agentReviewerRunning")}\n\n`,
  );
  const reviewerSystem =
    "You are the Reviewer. Check what the developer did based on the plan, suggest any improvements, or confirm it looks good. Be concise." +
    system;
  const review = await api.complete(connection, model, devHistory as ChatMessage[], reviewerSystem);

  h.onText(review);
}

/** Native OpenAI tool-use loop. */
async function runAgentNative(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
  system: string = AGENT_SYSTEM,
): Promise<void> {
  const messages: unknown[] = [
    { role: "system", content: system },
    ...toWire(history),
  ];

  const budget = stepBudget();
  const watch = newLoopWatch();
  let lastFailed = false;

  for (let i = 0; i < budget; i++) {
    if (h.cancelled?.()) return;

    // Anything the user typed while the run was going gets folded in here,
    // before the next request — so they can steer or ask a question mid-run
    // instead of watching the agent ignore them.
    for (const said of takeInterjections())
      messages.push({ role: "user", content: said });

    // Streaming: the model's words and thinking appear as they are produced.
    // The same call still returns the tool calls for the loop to execute — the
    // difference is only that the user is no longer staring at nothing.
    let streamed = "";
    const run = api.agentStepStream(connection, model, messages, AGENT_TOOLS, {
      onDelta: (d) => {
        streamed += d;
        h.onText(d);
      },
      onReasoning: (d) => h.onReasoning?.(d),
      onUsage: (u) => h.onUsage?.(u),
    });
    h.setStop?.(run.stop);
    const step = await run.promise;

    const called = (step.tool_calls?.length ?? 0) > 0;

    // A model can "call" a tool by typing it out instead of using the
    // protocol — Claude reaches for its native XML, other instruction-tuned
    // models copy the same shape. That is a text-protocol model, and printing
    // the markup at the user is the worst possible answer.
    const typedCall = called ? null : parseTextToolCall(step.content ?? "");

    // First turn decides how this model is driven from now on. Only two things
    // are conclusive: it called a tool properly (native), or it wrote a call as
    // text (react). Prose alone proves nothing — the question may simply not
    // have needed a tool — and marking on that was what stuck good models in
    // ReAct forever, since the mark persists across restarts.
    if (i === 0) {
      if (called) {
        useStore.getState().setModelTools(connection.id, model, "native");
      } else if (typedCall) {
        useStore.getState().setModelTools(connection.id, model, "react");
        return runAgentReAct(connection, model, history, h, system);
      }
    } else if (typedCall) {
      // Mid-run regression: finish this run in ReAct rather than stalling.
      return runAgentReAct(connection, model, history, h, system);
    }

    // Already streamed above; printing it again would duplicate the answer.
    if (step.content && !streamed) h.onText(step.content);

    if (!called) return; // final answer

    // The assistant turn that carries the tool calls must precede tool results.
    messages.push({
      role: "assistant",
      content: step.content ?? "",
      tool_calls: step.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Read-only calls in the same turn are independent, so run them together.
    // Five sequential file reads is five round trips of dead time for no
    // reason; anything that writes or executes still goes one at a time, in
    // order, because those can depend on each other.
    const READ_ONLY = new Set(["read_file", "list_dir", "grep", "search_code"]);
    const parsed = step.tool_calls.map((tc) => {
      let args: ToolArgs = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        /* leave empty */
      }
      return { tc, args };
    });

    if (
      parsed.length > 1 &&
      parsed.every(({ tc }) => READ_ONLY.has(tc.name)) &&
      !parsed.some(({ tc, args }) => needsConfirm(tc.name, args))
    ) {
      const results = await Promise.all(
        parsed.map(async ({ tc, args }) => {
          const startedAt = Date.now();
          h.onTool?.({ id: tc.id, name: tc.name, args, status: "running", startedAt });
          const result = await executeTool(tc.name, args);
          h.onTool?.({
            id: tc.id,
            name: tc.name,
            args,
            status: result.startsWith("error:") ? "error" : "done",
            startedAt,
            durationMs: Date.now() - startedAt,
            result: preview(result),
          });
          return { tc, result };
        }),
      );
      for (const { tc, result } of results)
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      continue;
    }

    for (const tc of step.tool_calls) {
      let args: ToolArgs = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        /* leave empty */
      }

      // Stop a run that is going in circles before it burns the user's credit.
      const stuck = checkLoop(watch, tc.name, args, lastFailed);
      if (stuck) {
        messages.push({ role: "tool", tool_call_id: tc.id, content: stuck });
        h.onTool?.({ id: tc.id, name: tc.name, args, status: "declined", result: stuck });
        h.onText(`\n\n_${tr("agentLoopStopped")}_`);
        return;
      }

      let result: string;
      const approved = needsConfirm(tc.name, args) ? await h.confirm(tc.name, args) : true;

      if (!approved) {
        result = "User declined this action.";
        h.onTool?.({ id: tc.id, name: tc.name, args, status: "declined" });
      } else {
        const startedAt = Date.now();
        h.onTool?.({ id: tc.id, name: tc.name, args, status: "running", startedAt });
        result = await executeTool(tc.name, args);
        lastFailed = result.startsWith("error:");
        // A command the user killed is not a failure to retry — say so plainly
        // so the model investigates instead of running it again.
        const killed = /\[killed/i.test(result);
        if (killed)
          result +=
            "\n\n[The user stopped this command manually — it was hanging or taking too long. Do not simply re-run it: work out why it hung, or ask the user.]";
        h.onTool?.({
          id: tc.id,
          name: tc.name,
          args,
          status: killed ? "killed" : lastFailed ? "error" : "done",
          startedAt,
          durationMs: Date.now() - startedAt,
          result: preview(result),
        });
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  h.onText(`\n\n_${tr("agentStepLimit")}_`);
}

const REACT_SYSTEM = `You are Magnetar, a local coding agent. A project folder is already open (its absolute path is given below as "Workspace root") and you can inspect and change it with the tools below. Never say you cannot see the user's files — look with list_dir or search_code first. You have tools but must call them via text. To use a tool, reply EXACTLY in this format and nothing else:
Thought: <your reasoning>
Action: <tool name>
Action Input: <a single-line JSON object of arguments>

Then stop — you will receive an "Observation:" with the result. Repeat as needed. When the task is complete, reply:
Thought: <reasoning>
Final Answer: <your answer to the user, ending with a Handoff Note:>
## Handoff Note
- **Status:** ...
- **Decisions:** ...
- **Next Steps:** ...

Paths may be given relative to the project root — they are resolved for you.

Available tools (Action Input is JSON):
- read_file {"path":"...","offset"?:n,"limit"?:n}
- list_dir {"path":"..."}
- grep {"pattern":"...","path"?:"..."}
- search_code {"query":"..."}  ← ranked search over the open project; best first step to find where something lives
- write_file {"path":"...","content":"..."}
- edit_file {"path":"...","old_string":"...","new_string":"..."}
- run_bash {"command":"...","cwd"?:"..."}
- attach_file {"path":"..."}
- ask_decision {"question":"...","options"?:["...","..."],"recommendation"?:"..."}  ← put a hard-to-reverse choice to the user; the answer is stored in the decision log
- flag_memory {"summary":"...","proposal"?:"...","evidence"?:"..."}  ← memory contradicts the code; queued for later, does not interrupt you`;

interface ReActParse {
  thought?: string;
  action?: string;
  input: ToolArgs;
  final?: string;
}

/** Extract a tool call that a model wrote as TEXT instead of calling properly.
 *
 *  Three shapes show up in the wild and all of them used to fall through:
 *
 *    1. Anthropic's native XML, which Claude emits from habit whenever it is
 *       driven by a text protocol — and which nvidia/nemotron and other
 *       instruction-tuned models copy:
 *         <function_calls><invoke name="run_bash">
 *           <parameter name="command">ls</parameter>
 *         </invoke></function_calls>
 *    2. The ReAct scaffolding we actually asked for: `Action:` / `Action Input:`
 *    3. A bare call: `list_dir {"path": "."}`
 *
 *  Unparsed, the model's call was printed into the chat as prose, nothing ran,
 *  and the model then apologised and printed it again — the loop the user saw. */
export function parseTextToolCall(
  text: string,
): { action: string; input: ToolArgs } | null {
  const known = AGENT_TOOLS.map((x) => x.name);

  // 1. XML function-call blocks.
  const invoke = text.match(
    /<invoke\s+name=["']([a-zA-Z_]+)["']\s*>([\s\S]*?)<\/invoke>/i,
  );
  if (invoke && known.includes(invoke[1])) {
    const input: ToolArgs = {};
    const paramRe = /<parameter\s+name=["']([a-zA-Z_]+)["']\s*>([\s\S]*?)<\/parameter>/gi;
    let m: RegExpExecArray | null;
    while ((m = paramRe.exec(invoke[2]))) {
      const raw = m[2].trim();
      // Parameters arrive as text; recover numbers, booleans and JSON so tools
      // that expect real types (read_file offset/limit) still work.
      let value: unknown = raw;
      if (/^-?\d+$/.test(raw)) value = Number(raw);
      else if (raw === "true" || raw === "false") value = raw === "true";
      else if (/^[[{]/.test(raw)) {
        try {
          value = JSON.parse(raw);
        } catch {
          /* keep the string */
        }
      }
      input[m[1]] = value as ToolArgs[string];
    }
    return { action: invoke[1], input };
  }

  // 2 and 3 are handled by the ReAct parser, which already knows both.
  const p = parseReAct(text);
  if (p.action && known.includes(p.action)) return { action: p.action, input: p.input };
  return null;
}

function parseReAct(text: string): ReActParse {
  const finalM = text.match(/Final Answer:\s*([\s\S]*)$/i);
  if (finalM) return { final: finalM[1].trim(), input: {} };

  const thought = text.match(/Thought:\s*(.*)/i)?.[1]?.trim();
  const action = text.match(/Action:\s*([a-zA-Z_]+)/i)?.[1]?.trim();

  const parseArgs = (raw: string): ToolArgs => {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    try {
      return JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned);
    } catch {
      return {};
    }
  };

  if (action) {
    const inputM = text.match(/Action Input:\s*([\s\S]*?)(?:\nObservation:|$)/i);
    return { thought, action, input: inputM ? parseArgs(inputM[1]) : {} };
  }

  // Weaker models drop the ReAct scaffolding and just write the call, e.g.
  // `list_dir {"path": "/"}` or a fenced block. Accept that rather than
  // letting the run stall — the tool name still has to be a real one.
  const known = AGENT_TOOLS.map((x) => x.name).join("|");
  const bare = text.match(
    new RegExp(`(?:^|\\n|\`{1,3})\\s*(${known})\\s*(\\{[\\s\\S]*?\\})`, "i"),
  );
  if (bare) return { thought, action: bare[1], input: parseArgs(bare[2]) };

  return { thought, action, input: {} };
}

/** Text-based ReAct loop for providers without native tool-use (e.g. GigaChat). */
async function runAgentReAct(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
  extraSystem: string = "",
): Promise<void> {
  const messages: ChatMessage[] = [...history];
  const mk = (role: ChatMessage["role"], content: string): ChatMessage => ({
    id: "", role, content, createdAt: 0,
  });

  const budget = stepBudget();
  const watch = newLoopWatch();
  let lastFailed = false;

  for (let i = 0; i < budget; i++) {
    if (h.cancelled?.()) return;

    for (const said of takeInterjections()) messages.push(mk("user", said));

    const text = await api.complete(connection, model, messages, REACT_SYSTEM + extraSystem);
    const p = parseReAct(text);

    // A model that wrote its call as XML is still trying to use a tool; run it
    // rather than printing the markup at the user.
    const xml = p.action ? null : parseTextToolCall(text);
    if (xml) {
      p.action = xml.action;
      p.input = xml.input;
    }

    if (p.final != null && !p.action) {
      h.onText((i > 0 ? "\n\n" : "") + p.final);
      return;
    }
    if (!p.action) {
      // Model answered without the ReAct format — treat as final.
      h.onText(text.trim());
      return;
    }

    const callId = `react-${i}`;

    const stuck = checkLoop(watch, p.action, p.input, lastFailed);
    if (stuck) {
      h.onTool?.({ id: callId, name: p.action, args: p.input, status: "declined", result: stuck });
      h.onText(`\n\n_${tr("agentLoopStopped")}_`);
      return;
    }

    let result: string;
    const approved = needsConfirm(p.action, p.input) ? await h.confirm(p.action, p.input) : true;

    if (!approved) {
      result = "User declined this action.";
      h.onTool?.({
        id: callId,
        name: p.action,
        args: p.input,
        status: "declined",
        thought: p.thought,
      });
    } else {
      const startedAt = Date.now();
      h.onTool?.({
        id: callId,
        name: p.action,
        args: p.input,
        status: "running",
        startedAt,
        thought: p.thought,
      });
      result = await executeTool(p.action, p.input);
      lastFailed = result.startsWith("error:");
      const killed = /\[killed/i.test(result);
      if (killed)
        result +=
          "\n\n[The user stopped this command manually — it was hanging or taking too long. Do not simply re-run it: work out why it hung, or ask the user.]";
      h.onTool?.({
        id: callId,
        name: p.action,
        args: p.input,
        status: killed ? "killed" : lastFailed ? "error" : "done",
        startedAt,
        durationMs: Date.now() - startedAt,
        result: preview(result),
        thought: p.thought,
      });
    }

    messages.push(mk("assistant", text));
    messages.push(mk("user", `Observation: ${result}`));
  }

  h.onText(`\n\n_${tr("agentStepLimit")}_`);
}

/** One-line human summary of a tool call — used by the run trace in the UI. */
export function summarizeArgs(name: string, args: ToolArgs): string {
  switch (name) {
    case "read_file":
    case "list_dir":
    case "write_file":
    case "edit_file":
    case "attach_file":
      return `→ ${args.path ?? ""}`;
    case "ask_decision":
      return `→ ${String(args.question ?? "").slice(0, 80)}`;
    case "flag_memory":
      return `→ ${String(args.summary ?? "").slice(0, 80)}`;
    case "grep":
      return `→ "${args.pattern ?? ""}"`;
    case "run_bash":
      return `→ ${String(args.command ?? "").slice(0, 80)}`;
    default:
      return "";
  }
}
