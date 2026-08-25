import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, Connection, ModelInfo, StreamEvent } from "./types";
import type { GenProvider, GeneratedImage } from "./generative";

/** True when we are running inside the Tauri shell (not a plain browser tab). */
export const HAS_BACKEND =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Outside Tauri every command would hang forever, leaving the UI stuck on a
 *  loading state. Fail fast with a clear message instead. */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!HAS_BACKEND)
    return Promise.reject(new Error(`Backend unavailable (${cmd})`));
  return tauriInvoke<T>(cmd, args);
}

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

  /** Generate images through an OpenAI-compatible `images/generations`
   *  endpoint. Separate from `complete`/`chat_stream`: the payload shape and
   *  response (base64 or URLs) have nothing in common with chat. */
  generateImage: (
    provider: GenProvider,
    model: string,
    prompt: string,
    n: number,
    size: string,
  ) =>
    invoke<GeneratedImage[]>("generate_image", {
      connection: {
        id: provider.id,
        kind: "openai_compat",
        base_url: provider.baseUrl,
        scope: null,
        ca_path: null,
      },
      model,
      prompt,
      n,
      size,
      responseFormat: provider.responseFormat ?? null,
    }),

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
      onReasoning?: (text: string) => void;
      onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void;
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
      else if (ev.type === "reasoning") opts.onReasoning?.(ev.content);
      else if (ev.type === "usage")
        opts.onUsage?.({
          inputTokens: ev.inputTokens ?? undefined,
          outputTokens: ev.outputTokens ?? undefined,
        });
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

  /** Streaming agent step. Text and reasoning arrive through the callbacks as
   *  the model produces them; the resolved value still carries the tool calls
   *  for the loop to execute. Returns a stop() alongside, so a long turn can be
   *  cancelled without waiting for it to finish. */
  agentStepStream(
    connection: Connection,
    model: string,
    messages: unknown[],
    tools: ToolDef[],
    opts: {
      onDelta?: (text: string) => void;
      onReasoning?: (text: string) => void;
      onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void;
    } = {},
  ): { promise: Promise<AgentStep>; stop: () => void } {
    const requestId =
      crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const channel = new Channel<StreamEvent>();
    channel.onmessage = (ev) => {
      if (ev.type === "delta") opts.onDelta?.(ev.content);
      else if (ev.type === "reasoning") opts.onReasoning?.(ev.content);
      else if (ev.type === "usage")
        opts.onUsage?.({
          inputTokens: ev.inputTokens ?? undefined,
          outputTokens: ev.outputTokens ?? undefined,
        });
    };

    const promise = invoke<AgentStep>("agent_step_stream", {
      connection: toRustConn(connection),
      model,
      messages,
      tools,
      requestId,
      onEvent: channel,
    });

    return {
      promise,
      stop: () => void invoke("cancel_stream", { requestId }).catch(() => {}),
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
  createProjectDir: (name: string) =>
    invoke<string>("create_project_dir", { name }),
  listProjectFiles: (root: string) =>
    invoke<string[]>("list_project_files", { root }),
  toolDeleteFile: (path: string) =>
    invoke<void>("tool_delete_file", { path }),
  editorReadFile: (path: string) =>
    invoke<string>("editor_read_file", { path }),
  indexBuild: (root: string) =>
    invoke<{ files: number; terms: number }>("index_build", { root }),
  indexSearch: (root: string, query: string, topK?: number) =>
    invoke<{ file: string; score: number; snippet: string; line: number }[]>(
      "index_search",
      { root, query, topK: topK ?? null },
    ),
  gitExec: (cwd: string, args: string[]) =>
    invoke<{ stdout: string; stderr: string; code: number; truncated: boolean }>(
      "git_exec",
      { cwd, args },
    ),
  toolEditFile: (path: string, oldString: string, newString: string) =>
    invoke<{ replaced: number; diff: string }>("tool_edit_file", {
      path,
      oldString,
      newString,
    }),
  toolRunBash: (command: string, cwd?: string, timeoutSecs?: number) =>
    invoke<{ stdout: string; stderr: string; code: number; truncated: boolean }>(
      "tool_run_bash",
      { command, cwd: cwd ?? null, timeoutSecs: timeoutSecs ?? null },
    ),
  toolKillBash: (pid?: number) =>
    invoke<void>("tool_kill_bash", { pid: pid ?? null }),
  toolAttachFile: (path: string) =>
    invoke<string>("tool_attach_file", { path }),
  extractPdfText: (path: string) =>
    invoke<string>("extract_pdf_text", { path }),

  // ---- Embedded terminal (PTY) ----
  ptySpawn: (
    id: string,
    cwd: string | undefined,
    cols: number,
    rows: number,
    onData: (data: string) => void,
  ) => {
    const channel = new Channel<string>();
    channel.onmessage = onData;
    return invoke<void>("pty_spawn", {
      id,
      cwd: cwd ?? null,
      cols,
      rows,
      onData: channel,
    });
  },
  ptyWrite: (id: string, data: string) =>
    invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: string) => invoke<void>("pty_kill", { id }),
};
