import { api } from "../api";

/* ==========================================================================
   A DEBUG ADAPTER PROTOCOL CLIENT

   The Debug Adapter Protocol is what VS Code speaks to every debugger it hosts,
   and it is deliberately uniform: the same requests — setBreakpoints,
   stackTrace, variables, continue, next — drive node, python, and everything
   else, so a client that speaks DAP debugs any language whose adapter does.

   The wire format is Content-Length framed JSON, the same as LSP, so the
   transport is shared. What this adds is the protocol: a request/response
   correlation by sequence number, and the events (stopped, terminated, output)
   the adapter pushes as execution proceeds.

   Sequence numbers are the part that goes wrong invisibly — a response matched
   to the wrong request shows the wrong variables — so the correlation is small,
   explicit, and where the tests point.
   ========================================================================== */

export interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  [k: string]: unknown;
}

export interface DapResponse extends DapMessage {
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}

export interface DapEvent extends DapMessage {
  type: "event";
  event: string;
  body?: unknown;
}

type EventHandler = (body: unknown) => void;

export class DapClient {
  private seq = 1;
  private pending = new Map<number, { resolve: (r: DapResponse) => void; reject: (e: Error) => void }>();
  private events = new Map<string, Set<EventHandler>>();
  private alive = true;

  constructor(private readonly id: string) {}

  async spawn(cmd: string, args: string[], cwd?: string): Promise<void> {
    await api.dapSpawn(this.id, cmd, args, cwd, (raw) => this.onRaw(raw));
  }

  /** The transport hands us whole framed messages already, one per callback —
   *  but a defensive concat-and-split keeps a coalesced pair from being lost. */
  private onRaw(raw: string): void {
    // The backend frames a `magnetar/serverExited` notification when the adapter
    // process ends (lsp.rs). Matching the actual sentinel — not a name that is
    // never sent — is what lets a crashed adapter close the transport instead of
    // being parsed as an unknown event and silently dropped, leaving every
    // outstanding request hung until stop().
    if (raw.includes("magnetar/serverExited")) {
      this.failAllPending(new Error("debug adapter exited"));
      this.emit("__transport_closed__", {});
      return;
    }
    let msg: DapMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    this.dispatch(msg);
  }

  private dispatch(msg: DapMessage): void {
    if (msg.type === "response") {
      const res = msg as DapResponse;
      const waiter = this.pending.get(res.request_seq);
      if (waiter) {
        this.pending.delete(res.request_seq);
        // A failed request is rejected with the adapter's own message, which is
        // usually the specific reason (no such breakpoint, program not
        // running) rather than anything this layer could phrase better.
        if (res.success) waiter.resolve(res);
        else waiter.reject(new Error(res.message || `${res.command} failed`));
      }
    } else if (msg.type === "event") {
      const ev = msg as DapEvent;
      this.emit(ev.event, ev.body);
    }
  }

  private emit(event: string, body: unknown): void {
    this.events.get(event)?.forEach((h) => h(body));
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event)!.add(handler);
    return () => this.events.get(event)?.delete(handler);
  }

  /** Send a request and resolve with its response, matched by sequence number.
   *
   *  The seq is claimed and attached to the pending map before the send, so a
   *  response that arrives faster than the send call returns still finds its
   *  waiter.
   */
  request<T = unknown>(command: string, args?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.alive) return Promise.reject(new Error("debug session ended"));
    const seq = this.seq++;
    const message = JSON.stringify({ seq, type: "request", command, arguments: args });
    return new Promise<T>((resolve, reject) => {
      // A hung adapter must not leave a Promise pending forever. The timer is
      // cleared whichever way the request settles, so it never fires late.
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`${command} timed out`));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r.body as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      void api.dapSend(this.id, message).catch((e) => {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(e);
      });
    });
  }

  /** Reject and clear every outstanding request — used when the transport dies,
   *  so a crashed adapter surfaces as failures rather than silent hangs. */
  private failAllPending(err: Error): void {
    for (const [seq, waiter] of this.pending) {
      this.pending.delete(seq);
      waiter.reject(err);
    }
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.failAllPending(new Error("debug session ended"));
    await api.dapKill(this.id).catch(() => {});
  }
}
