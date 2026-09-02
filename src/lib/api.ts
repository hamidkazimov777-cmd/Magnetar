import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, Connection, ModelInfo, StreamEvent } from "./types";

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

/** Where a provider key is kept. `plaintextfile` only ever occurs in a debug
 *  build: a release refuses to write a key to disk in the clear. */
export type KeyStorage = "keychain" | "plaintextfile" | "none";

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
  timeoutMs?: number;
}

export interface SearchHit {
  file: string;
  line: number;
  text: string;
  /** Where the match starts in `text`, so the result can be highlighted
   *  rather than leaving the reader to find it again. */
  column: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Stopped early, and which of the three reasons — they mean different
   *  things to the reader: narrow the query, wait longer, or nothing at all. */
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  filesScanned: number;
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

  // ---- Media generation (image + video) ----
  /** Generate an image. `api` picks the wire shape: "openai_images"
   *  (`/images/generations` → b64_json) or "chat_image" (`/chat/completions`
   *  with modalities → message.images[]). Returns produced assets. */
  genImage: (
    connection: Connection,
    api: "openai_images" | "chat_image",
    model: string,
    prompt: string,
    params?: Record<string, unknown>,
    images?: string[],
  ) =>
    invoke<{ assets: { url?: string; b64?: string; mime?: string }[] }>("gen_image", {
      connection: toRustConn(connection),
      api,
      model,
      prompt,
      params: params ?? null,
      images: images && images.length ? images : null,
    }),

  /** Submit an async video job (TokenRouter). Returns the task id to poll. */
  genVideoSubmit: (
    connection: Connection,
    model: string,
    prompt: string,
    params?: Record<string, unknown>,
  ) =>
    invoke<{ taskId: string }>("gen_video_submit", {
      connection: toRustConn(connection),
      model,
      prompt,
      params: params ?? null,
    }),

  /** Poll a video job. `url` is set once `status` reports success. */
  genVideoPoll: (connection: Connection, taskId: string) =>
    invoke<{ status: string; progress?: string; url?: string; failReason?: string }>(
      "gen_video_poll",
      { connection: toRustConn(connection), taskId },
    ),

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
  /** Tell the backend which folder is open, so path containment has something
   *  to contain against. A no-op outside the Tauri shell. */
  setWorkspaceRoot: (root: string | undefined) =>
    HAS_BACKEND
      ? tauriInvoke<void>("set_workspace_root", { root: root ?? null })
      : Promise.resolve(),
  /** Whether the open folder has been vouched for. */
  workspaceTrusted: () =>
    HAS_BACKEND ? tauriInvoke<boolean>("workspace_trusted") : Promise.resolve(true),
  /** Allow changes and commands in the open folder, and remember it. */
  trustWorkspace: () =>
    HAS_BACKEND ? tauriInvoke<void>("trust_workspace") : Promise.resolve(),
  /** Turn read-only mode on or off. The backend enforces it; this only asks. */
  setReadOnly: (on: boolean) =>
    HAS_BACKEND ? tauriInvoke<void>("set_read_only", { on }) : Promise.resolve(),
  /** Where a connection's key is actually stored, so the UI can say so rather
   *  than implying protection the build did not provide. */
  keyStorage: (connectionId: string) =>
    invoke<KeyStorage>("key_storage", { connectionId }),
  /** Search the project's text. Reports why it stopped, so a short list is
   *  never mistaken for a complete one. */
  searchText: (root: string, pattern: string, options: SearchOptions, id: string) =>
    invoke<SearchOutcome>("search_text", { root, pattern, options, id }),
  /** Stop one search by the id it was started with. */
  searchCancel: (id: string) => invoke<void>("search_cancel", { id }),
  /** Keep an attachment's bytes so the conversation still has them tomorrow.
   *  Addressed by id, never by path: there is no path here to point elsewhere. */
  attachmentWrite: (id: string, data: string) =>
    invoke<void>("attachment_write", { id, data }),
  /** Read them back. `null` means the file is gone; the message stays readable. */
  attachmentRead: (id: string) => invoke<string | null>("attachment_read", { id }),
  /** Ask where to save something. Choosing the destination is the permission,
   *  so the dialog belongs in the backend like the open picker. */
  pickSavePath: (suggestedName: string, extensions: string[]) =>
    invoke<string | null>("pick_save_path", { suggestedName, extensions }),
  /** What a database health check found. */
  dbIntegrity: () =>
    invoke<{
      structure: string;
      orphans: number;
      projects: number;
      facts: number;
      decisions: number;
      sessions: number;
      messages: number;
    }>("db_integrity"),
  /** Write a consistent copy of the whole database. Returns its size. */
  dbBackup: (dest: string) => invoke<number>("db_backup", { dest }),
  /** Open the system file picker in the backend. Choosing a file is what
   *  grants access to it, so the picker cannot live in the webview. */
  pickAttachments: (extensions: string[]) =>
    invoke<string[]>("pick_attachments", { extensions }),
  /** Read a file as base64 for attachments, through the backend path gate. */
  readFileBase64: (path: string) =>
    invoke<string>("read_file_base64", { path }),
  toolListDir: (path: string) =>
    invoke<{ name: string; isDir: boolean }[]>("tool_list_dir", { path }),
  toolGrep: (pattern: string, path?: string) =>
    invoke<{ file: string; line: number; text: string }[]>("tool_grep", {
      pattern,
      path: path ?? null,
    }),
  toolWriteFile: (path: string, content: string) =>
    invoke<number>("tool_write_file", { path, content }),
    toolCreateDir: (path: string) => invoke<void>("tool_create_dir", { path }),
    toolMoveFile: (from: string, to: string) =>
      invoke<void>("tool_move_file", { from, to }),
  createProjectDir: (name: string) =>
    invoke<string>("create_project_dir", { name }),
  listProjectFiles: (root: string) =>
    invoke<string[]>("list_project_files", { root }),
  toolDeleteFile: (path: string) =>
    invoke<void>("tool_delete_file", { path }),
  editorReadFile: (path: string) =>
    invoke<string>("editor_read_file", { path }),
  /** Follow the workspace's files, keeping the index current as they change. */
  indexWatch: (root: string) =>
    HAS_BACKEND ? invoke<void>("index_watch", { root }) : Promise.resolve(),
  indexUnwatch: (root: string) =>
    HAS_BACKEND ? invoke<void>("index_unwatch", { root }) : Promise.resolve(),
  /** Bring the index up to date, reading only what changed. Returns coverage:
   *  how many files are indexed, changed this sync, removed, and skipped. */
  indexBuild: (root: string) =>
    invoke<{ files: number; changed: number; removed: number; skipped: number }>("index_build", {
      root,
    }),
  indexSearch: (root: string, query: string, topK?: number) =>
    invoke<{ file: string; score: number; snippet: string; line: number }[]>(
      "index_search",
      { root, query, topK: topK ?? null },
    ),
  /** Apply a patch to the index or working tree (hunk-level staging). The
   *  patch is data; `args` are the apply flags the caller chose. */
  gitApply: (cwd: string, args: string[], patch: string) =>
    invoke<{ stdout: string; stderr: string; code: number }>("git_apply", {
      cwd,
      args,
      patch,
    }),
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

  /** Resolve a language-server binary on PATH, or null if it isn't installed. */
  lspWhich: (bin: string) => invoke<string | null>("lsp_which", { bin }),
  /** Start a language server; every message it emits arrives via onMsg. */
  lspSpawn: (
    id: string,
    cmd: string,
    args: string[],
    cwd: string | undefined,
    onMsg: (message: string) => void,
  ) => {
    const channel = new Channel<string>();
    channel.onmessage = onMsg;
    return invoke<void>("lsp_spawn", {
      id,
      cmd,
      args,
      cwd: cwd ?? null,
      onMsg: channel,
    });
  },
  lspSend: (id: string, message: string) =>
    invoke<void>("lsp_send", { id, message }),
  lspKill: (id: string) => invoke<void>("lsp_kill", { id }),

  /** Spawn a debug adapter. Same transport as an LSP server — Content-Length
   *  framed JSON over stdio — different protocol on top. */
  dapSpawn: (
    id: string,
    cmd: string,
    args: string[],
    cwd: string | undefined,
    onMsg: (message: string) => void,
  ) => {
    const channel = new Channel<string>();
    channel.onmessage = onMsg;
    return invoke<void>("dap_spawn", { id, cmd, args, cwd: cwd ?? null, onMsg: channel });
  },
  dapSend: (id: string, message: string) => invoke<void>("dap_send", { id, message }),
  dapKill: (id: string) => invoke<void>("dap_kill", { id }),
};
