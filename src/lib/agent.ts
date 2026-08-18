import { api, type ToolDef } from "./api";
import type { ChatMessage, Connection } from "./types";

/** Tools exposed to the model (OpenAI function schemas). */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read a text file. Returns its contents (may be truncated).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute or relative path" } },
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
];

/** Tools that change the machine — require explicit user confirmation. */
export const DESTRUCTIVE = new Set(["write_file", "edit_file", "run_bash"]);

export const AGENT_SYSTEM = `You are Magnetar, a local coding agent with tools to read and change the user's machine. Use the tools to accomplish the task: inspect files before editing, make surgical edits, and verify with commands when useful. Keep responses concise. When done, give a short summary of what you did.`;

const MAX_ITERS = 10;

type ToolArgs = Record<string, unknown>;

/** Execute one tool and return a compact string result for the model. */
export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const r = await api.toolReadFile(String(args.path));
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
}

/** Convert canon messages to OpenAI wire messages. */
function toWire(messages: ChatMessage[]): unknown[] {
  return messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Run the agentic tool-use loop. Returns the final assistant text. */
export async function runAgent(
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

function summarizeArgs(name: string, args: ToolArgs): string {
  switch (name) {
    case "read_file":
    case "list_dir":
    case "write_file":
    case "edit_file":
      return `→ ${args.path ?? ""}`;
    case "grep":
      return `→ "${args.pattern ?? ""}"`;
    case "run_bash":
      return `→ ${String(args.command ?? "").slice(0, 80)}`;
    default:
      return "";
  }
}
