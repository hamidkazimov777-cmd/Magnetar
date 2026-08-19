import { api, type ToolDef } from "./api";
import { useStore } from "./store";
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
export function needsConfirm(name: string): boolean {
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
- Long-running servers (npm run dev, vite, watchers) never exit, so do NOT run them in the foreground — they would just hit the timeout. Start them detached, e.g. \`npm run dev > /tmp/dev.log 2>&1 &\`, wait a moment, check the log for the URL, then give the user that URL.
- Keep prose short. The user sees every tool call, so do not narrate what the trace already shows.

When the task is complete, end with:
## Handoff Note
- **Status:** what now works (and what you verified)
- **Decisions:** key technical choices
- **Next Steps:** what remains, if anything`;

/** Fallback when prefs are unavailable; the real budget lives in Prefs. */
const MAX_ITERS = 40;

const stepBudget = () => useStore.getState().prefs?.agentMaxSteps ?? MAX_ITERS;

type ToolArgs = Record<string, unknown>;

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
  status: "running" | "done" | "error" | "declined";
  /** Short preview of the tool output (already truncated for display). */
  result?: string;
  /** ReAct providers expose the model's reasoning for the step. */
  thought?: string;
}

export interface AgentHandlers {
  /** Ask the user to approve a destructive tool call. */
  confirm: (name: string, args: ToolArgs) => Promise<boolean>;
  /** Append visible assistant prose to the chat. */
  onText: (text: string) => void;
  /** Report a tool step starting/finishing (structured, rendered as a card). */
  onTool?: (e: AgentToolEvent) => void;
  /** Announce a named phase of a multi-role run (Architect/Developer/Reviewer). */
  onPhase?: (label: string, running: boolean) => void;
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

/** True when the latest user message is about the project rather than small
 *  talk — those are the turns where a missing tool call is a real failure. */
function wantsTools(history: ChatMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  if (last.trim().length === 0) return false;
  // Anything longer than a greeting, or mentioning code/files/the project.
  const chatty = /^(привет|прив|здоров|хай|как дела|спасибо|ок|окей|пока|hi|hello|hey|thanks|thank you|yo|sup)\b/i;
  if (chatty.test(last.trim()) && last.trim().length < 40) return false;
  return true;
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
  for (let i = 0; i < budget; i++) {
    if (h.cancelled?.()) return;
    const step = await api.agentStep(connection, model, messages, AGENT_TOOLS);

    const called = (step.tool_calls?.length ?? 0) > 0;

    // First turn decides how this model is driven from now on.
    if (i === 0) {
      if (called) {
        useStore.getState().setModelTools(connection.id, model, "native");
      } else if (wantsTools(history)) {
        // The request clearly needs the project, yet the model produced prose
        // and no tool call: it does not really do function-calling. Redo the
        // whole turn in ReAct instead of leaving the user with an excuse.
        useStore.getState().setModelTools(connection.id, model, "react");
        return runAgentReAct(connection, model, history, h, system);
      }
    }

    if (step.content) h.onText(step.content);

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

    for (const tc of step.tool_calls) {
      let args: ToolArgs = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        /* leave empty */
      }

      let result: string;
      const approved = needsConfirm(tc.name) ? await h.confirm(tc.name, args) : true;

      if (!approved) {
        result = "User declined this action.";
        h.onTool?.({ id: tc.id, name: tc.name, args, status: "declined" });
      } else {
        h.onTool?.({ id: tc.id, name: tc.name, args, status: "running" });
        result = await executeTool(tc.name, args);
        h.onTool?.({
          id: tc.id,
          name: tc.name,
          args,
          status: result.startsWith("error:") ? "error" : "done",
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
- attach_file {"path":"..."}`;

interface ReActParse {
  thought?: string;
  action?: string;
  input: ToolArgs;
  final?: string;
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
  for (let i = 0; i < budget; i++) {
    if (h.cancelled?.()) return;
    const text = await api.complete(connection, model, messages, REACT_SYSTEM + extraSystem);
    const p = parseReAct(text);

    if (p.final != null) {
      h.onText((i > 0 ? "\n\n" : "") + p.final);
      return;
    }
    if (!p.action) {
      // Model answered without the ReAct format — treat as final.
      h.onText(text.trim());
      return;
    }

    const callId = `react-${i}`;
    let result: string;
    const approved = needsConfirm(p.action) ? await h.confirm(p.action, p.input) : true;

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
      h.onTool?.({
        id: callId,
        name: p.action,
        args: p.input,
        status: "running",
        thought: p.thought,
      });
      result = await executeTool(p.action, p.input);
      h.onTool?.({
        id: callId,
        name: p.action,
        args: p.input,
        status: result.startsWith("error:") ? "error" : "done",
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
    case "grep":
      return `→ "${args.pattern ?? ""}"`;
    case "run_bash":
      return `→ ${String(args.command ?? "").slice(0, 80)}`;
    default:
      return "";
  }
}
