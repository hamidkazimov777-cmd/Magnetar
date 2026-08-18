import { invoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, Connection, ModelInfo, StreamEvent } from "./types";

export interface ToolDef {
  name: string;
  description: string;
  parameters: unknown;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface AgentStep {
  content: string | null;
  tool_calls: ToolCall[];
}

/** Rust `Connection` uses snake_case keys. */
function toRustConn(c: Connection) {
  return {
    id: c.id,
    kind: c.kind,
    base_url: c.baseUrl,
    scope: c.scope ?? null,
    ca_path: c.caPath ?? null,
  };
}

export const api = {
  saveApiKey: (connectionId: string, key: string) =>
    invoke<void>("save_api_key", { connectionId, key }),

  deleteApiKey: (connectionId: string) =>
    invoke<void>("delete_api_key", { connectionId }),

  hasApiKey: (connectionId: string) =>
    invoke<boolean>("has_api_key", { connectionId }),

  listModels: (connection: Connection) =>
    invoke<ModelInfo[]>("list_models", { connection: toRustConn(connection) }),

  /** Single-shot non-streaming completion (router / summarizer). */
  complete: (
    connection: Connection,
    model: string,
    messages: ChatMessage[],
    system?: string,
  ) =>
    invoke<string>("complete", {
      connection: toRustConn(connection),
      params: {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? null,
        })),
        system: system ?? null,
        temperature: 0,
      },
    }),

  /** Stream a chat completion. Returns a stop() that abandons the UI stream
   *  (the backend request itself completes on its own). */
  chatStream(
    connection: Connection,
    model: string,
    messages: ChatMessage[],
    opts: {
      system?: string;
      temperature?: number;
      onDelta: (text: string) => void;
      onDone: () => void;
      onError: (message: string) => void;
    },
  ): () => void {
    let stopped = false;
    const requestId =
      crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (ev) => {
      if (stopped) return;
      if (ev.type === "delta") opts.onDelta(ev.content);
      else if (ev.type === "done") opts.onDone();
      else if (ev.type === "error") opts.onError(ev.message);
    };

    invoke<void>("chat_stream", {
      connection: toRustConn(connection),
      params: {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? null,
        })),
        system: opts.system ?? null,
        temperature: opts.temperature ?? null,
      },
      requestId,
      onEvent: channel,
    }).catch((e) => {
      if (!stopped) opts.onError(String(e));
    });

    return () => {
      stopped = true;
      // Tell the backend to stop generating (stops billing/work too).
      void invoke("cancel_stream", { requestId }).catch(() => {});
    };
  },

  // ---- Agent (tool-use) ----
  agentStep: (
    connection: Connection,
    model: string,
    messages: unknown[],
    tools: ToolDef[],
  ) =>
    invoke<AgentStep>("agent_step", {
      connection: toRustConn(connection),
      model,
      messages,
      tools,
    }),

  toolReadFile: (path: string, offset?: number, limit?: number) =>
    invoke<{ content: string; truncated: boolean; bytes: number }>(
      "tool_read_file",
      { path, offset: offset ?? null, limit: limit ?? null },
    ),
  toolListDir: (path: string) =>
    invoke<{ name: string; isDir: boolean }[]>("tool_list_dir", { path }),
  toolGrep: (pattern: string, path?: string) =>
    invoke<{ file: string; line: number; text: string }[]>("tool_grep", {
      pattern,
      path: path ?? null,
    }),
  toolWriteFile: (path: string, content: string) =>
    invoke<number>("tool_write_file", { path, content }),
  toolEditFile: (path: string, oldString: string, newString: string) =>
    invoke<{ replaced: number; diff: string }>("tool_edit_file", {
      path,
      oldString,
      newString,
    }),
  toolRunBash: (command: string, cwd?: string) =>
    invoke<{ stdout: string; stderr: string; code: number; truncated: boolean }>(
      "tool_run_bash",
      { command, cwd: cwd ?? null },
    ),
  toolKillBash: (pid?: number) =>
    invoke<void>("tool_kill_bash", { pid: pid ?? null }),
  toolAttachFile: (path: string) =>
    invoke<string>("tool_attach_file", { path }),
  extractPdfText: (path: string) =>
    invoke<string>("extract_pdf_text", { path }),
};
