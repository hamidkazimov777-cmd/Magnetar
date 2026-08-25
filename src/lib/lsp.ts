import { api } from "./api";

/* ==========================================================================
   LSP CLIENT

   A minimal JSON-RPC 2.0 client over the Rust `lsp` bridge — one instance per
   running language server. Its whole job is correlation: match each response to
   the request that asked for it (by id), and route server-initiated messages to
   handlers. Editor features (definition, hover, …) are built on top in 3.2.
   ========================================================================== */

type Json = Record<string, unknown>;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

export class LspClient {
  private seq = 1;
  private pending = new Map<number, Pending>();
  private notifyHandlers = new Map<string, (params: unknown) => void>();
  private requestHandlers = new Map<string, (params: unknown) => unknown>();
  private exited = false;
  /** Called once when the server process ends (crash, kill, or clean exit). */
  onExit?: () => void;

  constructor(
    readonly id: string,
    private readonly cmd: string,
    private readonly args: string[],
    private readonly cwd: string | undefined,
  ) {}

  /** Spawn the server and begin receiving its messages. */
  async start(): Promise<void> {
    await api.lspSpawn(this.id, this.cmd, this.args, this.cwd, (raw) =>
      this.dispatch(raw),
    );
  }

  /** Send a request and resolve with its result (or reject with its error).
   *
   *  Two resilience guards: a timeout so a hung server never leaves an editor
   *  feature waiting forever, and an optional cancellation token (Monaco hands
   *  one to every provider) so a superseded request — you moved the cursor, the
   *  old hover no longer matters — is dropped and `$/cancelRequest` is sent. */
  request<T = unknown>(
    method: string,
    params?: unknown,
    opts: { token?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => void }; timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.exited) return Promise.reject(new Error("language server exited"));
    const id = this.seq++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.pending.delete(id);
        fn();
      };
      const timer = setTimeout(
        () => done(() => reject(new Error(`language server timed out on ${method}`))),
        opts.timeoutMs ?? 15000,
      );
      this.pending.set(id, {
        resolve: (v) => done(() => (resolve as (x: unknown) => void)(v)),
        reject: (e) => done(() => reject(e)),
      });
      if (opts.token?.isCancellationRequested) {
        done(() => reject(new Error("cancelled")));
        return;
      }
      opts.token?.onCancellationRequested(() => {
        if (!this.pending.has(id)) return;
        this.notify("$/cancelRequest", { id });
        done(() => reject(new Error("cancelled")));
      });
      api.lspSend(this.id, payload).catch((e) => done(() => reject(e)));
    });
  }

  /** Fire-and-forget: notifications have no id and no reply. */
  notify(method: string, params?: unknown): void {
    if (this.exited) return;
    void api
      .lspSend(this.id, JSON.stringify({ jsonrpc: "2.0", method, params }))
      .catch(() => {});
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notifyHandlers.set(method, handler);
  }

  onRequest(method: string, handler: (params: unknown) => unknown): void {
    this.requestHandlers.set(method, handler);
  }

  /** Stop the server and reject anything still in flight. */
  async stop(): Promise<void> {
    this.fail(new Error("language server stopped"));
    await api.lspKill(this.id).catch(() => {});
  }

  private dispatch(raw: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(raw) as Json;
    } catch {
      return; // a malformed frame must never take down the client
    }

    // The Rust side pushes this synthetic notice when the process ends.
    if (msg.method === "magnetar/serverExited") {
      this.fail(new Error("language server exited"));
      return;
    }

    const hasId = "id" in msg && msg.id !== null;
    const isResponse =
      hasId && msg.method === undefined && ("result" in msg || "error" in msg);

    // A response to one of our requests. `result` may legitimately be null
    // (e.g. "no definition found"), so test membership, not value.
    if (isResponse) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if ("error" in msg && msg.error) p.reject(msg.error);
      else p.resolve((msg as { result?: unknown }).result);
      return;
    }

    // A server → client request (has both id and method). Answer it, or reply
    // "method not found" so the server never blocks waiting on us.
    if (hasId && typeof msg.method === "string") {
      const handler = this.requestHandlers.get(msg.method);
      const reply = (result: unknown, error?: unknown) =>
        void api
          .lspSend(
            this.id,
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              ...(error ? { error } : { result }),
            }),
          )
          .catch(() => {});
      if (handler) {
        try {
          reply(handler(msg.params));
        } catch (e) {
          reply(undefined, { code: -32603, message: String(e) });
        }
      } else {
        reply(undefined, { code: -32601, message: "method not found" });
      }
      return;
    }

    // A plain notification (method, no id).
    if (typeof msg.method === "string") {
      this.notifyHandlers.get(msg.method)?.(msg.params);
    }
  }

  private fail(err: unknown): void {
    if (this.exited) return;
    this.exited = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.onExit?.();
  }
}
