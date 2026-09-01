import { DapClient } from "./dap";
import { debugpyLaunchBody, lldbLaunchBody, launchConfig, type DebuggerId, type LaunchConfig } from "./adapters";

/* ==========================================================================
   ONE DEBUG SESSION, DRIVEN THROUGH DAP

   The protocol is a fixed dance: initialize, then when the adapter says it is
   ready (the `initialized` event), send the breakpoints and configurationDone,
   then launch. When execution stops — a breakpoint, a step, an exception — the
   adapter sends `stopped`, and the UI pulls the thread, its stack, and the
   variables in the top frame.

   The order matters and is easy to get subtly wrong: breakpoints set before
   `initialized` are dropped, and a `launch` sent before `configurationDone`
   races the breakpoints. This runs the sequence in the order the spec fixes,
   in one place, so no UI has to know it.
   ========================================================================== */

export interface StackFrame {
  id: number;
  name: string;
  path?: string;
  line: number;
}

export interface Scope {
  name: string;
  variablesReference: number;
}

export interface Variable {
  name: string;
  value: string;
  /** Non-zero when the value can be expanded (an object, a list). */
  variablesReference: number;
}

export interface SessionCallbacks {
  /** Execution stopped; reason is "breakpoint", "step", "exception", etc. */
  onStopped: (reason: string) => void;
  /** The program is running (after continue/step). */
  onRunning: () => void;
  /** A line of program output, or the adapter's own. */
  onOutput: (text: string, category: string) => void;
  /** The session ended, cleanly or not. */
  onTerminated: () => void;
}

export class DebugSession {
  private client: DapClient;
  private threadId: number | null = null;
  private unsubs: Array<() => void> = [];

  constructor(
    private readonly dbg: DebuggerId,
    private readonly callbacks: SessionCallbacks,
  ) {
    this.client = new DapClient(`dap-${Date.now()}`);
  }

  /** Start the adapter, run the handshake, set breakpoints, and launch.
   *
   *  `breakpoints` is a map of absolute file path to line numbers. Sent between
   *  `initialized` and `configurationDone`, which is the only window the spec
   *  allows.
   */
  async start(
    spec: { command: string; args: string[] },
    config: LaunchConfig,
    breakpoints: Map<string, number[]>,
  ): Promise<void> {
    this.wireEvents();
    await this.client.spawn(spec.command, spec.args, config.cwd);

    await this.client.request("initialize", {
      clientID: "magnetar",
      adapterID: this.dbg,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsRunInTerminalRequest: false,
    });

    // The adapter emits `initialized` when it is ready for configuration. Set
    // breakpoints there, then configurationDone, then launch.
    this.client.on("initialized", () => {
      void (async () => {
        for (const [path, lines] of breakpoints) {
          await this.client
            .request("setBreakpoints", {
              source: { path },
              breakpoints: lines.map((line) => ({ line })),
            })
            .catch(() => {});
        }
        await this.client.request("configurationDone").catch(() => {});
      })();
    });

    const body =
      this.dbg === "python"
        ? debugpyLaunchBody(config)
        : this.dbg === "rust"
          ? lldbLaunchBody(config)
          : { ...config };
    await this.client.request("launch", body);
  }

  private wireEvents(): void {
    this.unsubs.push(
      this.client.on("stopped", (body) => {
        const b = body as { threadId?: number; reason?: string };
        if (b.threadId) this.threadId = b.threadId;
        this.callbacks.onStopped(b.reason ?? "stopped");
      }),
      this.client.on("continued", () => this.callbacks.onRunning()),
      this.client.on("output", (body) => {
        const b = body as { output?: string; category?: string };
        if (b.output) this.callbacks.onOutput(b.output, b.category ?? "console");
      }),
      this.client.on("terminated", () => this.callbacks.onTerminated()),
      this.client.on("exited", () => this.callbacks.onTerminated()),
      this.client.on("__transport_closed__", () => this.callbacks.onTerminated()),
    );
  }

  /** The frames of the stopped thread, top first. */
  async stackTrace(): Promise<StackFrame[]> {
    if (this.threadId == null) return [];
    const res = await this.client
      .request<{ stackFrames?: Array<{ id: number; name: string; line: number; source?: { path?: string } }> }>(
        "stackTrace",
        { threadId: this.threadId },
      )
      .catch(() => ({ stackFrames: [] as never[] }));
    return (res.stackFrames ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      line: f.line,
      path: f.source?.path,
    }));
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const res = await this.client
      .request<{ scopes?: Scope[] }>("scopes", { frameId })
      .catch(() => ({ scopes: [] as Scope[] }));
    return res.scopes ?? [];
  }

  async variables(reference: number): Promise<Variable[]> {
    const res = await this.client
      .request<{ variables?: Variable[] }>("variables", { variablesReference: reference })
      .catch(() => ({ variables: [] as Variable[] }));
    return res.variables ?? [];
  }

  /** Evaluate an expression in a frame — the debug console, and watches. */
  async evaluate(expression: string, frameId?: number): Promise<string> {
    const res = await this.client.request<{ result?: string }>("evaluate", {
      expression,
      frameId,
      context: "repl",
    });
    return res.result ?? "";
  }

  continue(): Promise<unknown> {
    this.callbacks.onRunning();
    return this.client.request("continue", { threadId: this.threadId }).catch(() => {});
  }
  next(): Promise<unknown> {
    return this.client.request("next", { threadId: this.threadId }).catch(() => {});
  }
  stepIn(): Promise<unknown> {
    return this.client.request("stepIn", { threadId: this.threadId }).catch(() => {});
  }
  stepOut(): Promise<unknown> {
    return this.client.request("stepOut", { threadId: this.threadId }).catch(() => {});
  }
  pause(): Promise<unknown> {
    return this.client.request("pause", { threadId: this.threadId }).catch(() => {});
  }

  /** Change breakpoints in a file mid-session. */
  async setBreakpoints(path: string, lines: number[]): Promise<void> {
    await this.client
      .request("setBreakpoints", {
        source: { path },
        breakpoints: lines.map((line) => ({ line })),
      })
      .catch(() => {});
  }

  async stop(): Promise<void> {
    this.unsubs.forEach((u) => u());
    await this.client.request("disconnect", { terminateDebuggee: true }).catch(() => {});
    await this.client.stop();
  }
}

export { launchConfig };
