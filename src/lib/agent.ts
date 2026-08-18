import { api, type ToolDef } from "./api";
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

/** Tools that change the machine — require explicit user confirmation. */
export const DESTRUCTIVE = new Set(["write_file", "edit_file", "run_bash"]);

export const AGENT_SYSTEM = `You are Magnetar, a local coding agent with tools to read and change the user's machine. Use the tools to accomplish the task: inspect files before editing, make surgical edits, and verify with commands when useful. Keep responses concise. When you have finished the task, you MUST output a brief structural note with the following format:
## Handoff Note
- **Status:** (what was accomplished)
- **Decisions:** (key technical decisions or changes)
- **Next Steps:** (open questions or what to do next)`;

const MAX_ITERS = 10;

type ToolArgs = Record<string, unknown>;

/** Execute one tool and return a compact string result for the model. */
export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const r = await api.toolReadFile(
          String(args.path),
          args.offset != null ? Number(args.offset) : undefined,
          args.limit != null ? Number(args.limit) : undefined,
        );
        return r.truncated ? `${r.content}\n[truncated, ${r.bytes} bytes total]` : r.content;
      }
      case "list_dir": {
        const r = await api.toolListDir(String(args.path));
        return r.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n") || "(empty)";
      }
      case "grep": {
        const r = await api.toolGrep(String(args.pattern), args.path ? String(args.path) : undefined);
        return r.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n") || "(no matches)";
      }
      case "write_file": {
        const n = await api.toolWriteFile(String(args.path), String(args.content));
        return `wrote ${n} bytes to ${args.path}`;
      }
      case "edit_file": {
        const r = await api.toolEditFile(
          String(args.path),
          String(args.old_string),
          String(args.new_string),
        );
        return `edited ${args.path} (1 replacement)\n${r.diff}`;
      }
      case "run_bash": {
        const r = await api.toolRunBash(String(args.command), args.cwd ? String(args.cwd) : undefined);
        return `exit ${r.code}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`;
      }
      case "attach_file": {
        const result = await api.toolAttachFile(String(args.path));
        return result;
      }
      default:
        return `unknown tool: ${name}`;
    }
  } catch (e) {
    return `error: ${String(e)}`;
  }
}

export interface AgentHandlers {
  /** Ask the user to approve a destructive tool call. */
  confirm: (name: string, args: ToolArgs) => Promise<boolean>;
  /** Append visible progress (assistant text / tool step) to the chat. */
  onText: (text: string) => void;
  /** Returns true when the user pressed Stop — the loop halts between steps. */
  cancelled?: () => boolean;
}

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
): Promise<void> {
  if (isTeam) {
    return runTeamAgent(connection, model, history, h);
  }
  if (connection.kind === "openai_compat") {
    return runAgentNative(connection, model, history, h);
  }
  return runAgentReAct(connection, model, history, h);
}

export async function runTeamAgent(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
): Promise<void> {
  if (h.cancelled?.()) return;

  h.onText("🏛️ **Architect** is analyzing the request and creating a plan...\n\n");
  const architectSystem = "You are the Architect. Analyze the user request, break it down into a clear technical plan with steps. Do not execute code. Just output the plan.";
  const plan = await api.complete(connection, model, history, architectSystem);
  
  if (h.cancelled?.()) return;
  h.onText(`${plan}\n\n---\n\n🛠️ **Developer** is implementing the plan...\n\n`);
  
  const devHistory = [...history, { id: "plan", role: "assistant", content: plan, createdAt: 0 }];
  // Run developer
  if (connection.kind === "openai_compat") {
    await runAgentNative(connection, model, devHistory as ChatMessage[], h);
  } else {
    await runAgentReAct(connection, model, devHistory as ChatMessage[], h);
  }

  if (h.cancelled?.()) return;
  h.onText("\n\n---\n\n👀 **Reviewer** is checking the changes...\n\n");
  const reviewerSystem = "You are the Reviewer. Check what the developer did based on the plan, suggest any improvements, or confirm it looks good. Be concise.";
  const review = await api.complete(connection, model, devHistory as ChatMessage[], reviewerSystem);
  
  h.onText(review);
}

/** Native OpenAI tool-use loop. */
async function runAgentNative(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
): Promise<void> {
  const messages: unknown[] = [
    { role: "system", content: AGENT_SYSTEM },
    ...toWire(history),
  ];

  for (let i = 0; i < MAX_ITERS; i++) {
    if (h.cancelled?.()) return;
    const step = await api.agentStep(connection, model, messages, AGENT_TOOLS);

    if (step.content) h.onText(step.content);

    if (!step.tool_calls || step.tool_calls.length === 0) return; // final answer

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
      if (DESTRUCTIVE.has(tc.name)) {
        const ok = await h.confirm(tc.name, args);
        if (!ok) {
          result = "User declined this action.";
          h.onText(`\n\n\`${tc.name}\` — ⛔ отклонено пользователем`);
        } else {
          h.onText(`\n\n\`${tc.name}\` ${summarizeArgs(tc.name, args)}`);
          result = await executeTool(tc.name, args);
        }
      } else {
        h.onText(`\n\n\`${tc.name}\` ${summarizeArgs(tc.name, args)}`);
        result = await executeTool(tc.name, args);
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  h.onText("\n\n_(достигнут лимит шагов агента)_");
}

const REACT_SYSTEM = `You are Magnetar, a local coding agent. You have tools but must call them via text. To use a tool, reply EXACTLY in this format and nothing else:
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

Available tools (Action Input is JSON):
- read_file {"path":"...","offset"?:n,"limit"?:n}
- list_dir {"path":"..."}
- grep {"pattern":"...","path"?:"..."}
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
  let input: ToolArgs = {};
  const inputM = text.match(/Action Input:\s*([\s\S]*?)(?:\nObservation:|$)/i);
  if (inputM) {
    const raw = inputM[1].trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    try {
      input = JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : raw);
    } catch {
      input = {};
    }
  }
  return { thought, action, input };
}

/** Text-based ReAct loop for providers without native tool-use (e.g. GigaChat). */
async function runAgentReAct(
  connection: Connection,
  model: string,
  history: ChatMessage[],
  h: AgentHandlers,
): Promise<void> {
  const messages: ChatMessage[] = [...history];
  const mk = (role: ChatMessage["role"], content: string): ChatMessage => ({
    id: "", role, content, createdAt: 0,
  });

  for (let i = 0; i < MAX_ITERS; i++) {
    if (h.cancelled?.()) return;
    const text = await api.complete(connection, model, messages, REACT_SYSTEM);
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

    h.onText(
      `${i > 0 ? "\n\n" : ""}${p.thought ? `${p.thought}\n` : ""}\`${p.action}\` ${summarizeArgs(p.action, p.input)}`,
    );

    let result: string;
    if (DESTRUCTIVE.has(p.action)) {
      const ok = await h.confirm(p.action, p.input);
      if (!ok) {
        result = "User declined this action.";
        h.onText(" ⛔");
      } else {
        result = await executeTool(p.action, p.input);
      }
    } else {
      result = await executeTool(p.action, p.input);
    }

    messages.push(mk("assistant", text));
    messages.push(mk("user", `Observation: ${result}`));
  }

  h.onText("\n\n_(достигнут лимит шагов агента)_");
}

function summarizeArgs(name: string, args: ToolArgs): string {
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
