/* ==========================================================================
   WHICH DEBUG ADAPTER, AND HOW TO LAUNCH IT

   A debugger is only as available as its adapter. Python's — debugpy — is a
   clean `pip install debugpy` and speaks DAP over stdio directly, so it is the
   first-class target. Node's mature adapter (vscode-js-debug) is a large
   separate install that does not run over plain stdio without ceremony, so it
   is offered with an onboarding hint the way a missing language server is,
   rather than pretended to be present.

   This file is the mapping and nothing else, so the choice of adapter and the
   shape of a launch config are testable without spawning anything.
   ========================================================================== */

export type DebuggerId = "python" | "node" | "rust";

export interface AdapterSpec {
  id: DebuggerId;
  label: string;
  probe: string;
  install: string;
  command: string;
  args: string[];
  /** False for adapters not yet wired for launch — offered with an install
   *  hint rather than pretended to work. */
  ready: boolean;
  /** Absolute paths to try when `command` is not on PATH. lldb-dap ships with a
   *  keg-only Homebrew LLVM that does not link into /usr/local/bin, so the
   *  binary is present but invisible to a plain `which`. */
  fallbacks?: string[];
  /** A compiled-language adapter debugs an executable, not a source file, so the
   *  source has to be built first and the artifact path resolved. Interpreted
   *  adapters (python) leave this unset and debug the file directly. */
  build?: "cargo";
}

export const ADAPTERS: Record<DebuggerId, AdapterSpec> = {
  python: {
    id: "python",
    label: "Python (debugpy)",
    probe: "python3",
    install: "pip install debugpy",
    command: "python3",
    args: ["-m", "debugpy.adapter"],
    ready: true,
  },
  rust: {
    id: "rust",
    label: "Rust (lldb-dap)",
    probe: "lldb-dap",
    install: "lldb-dap is needed (LLVM 18+ / Xcode 16+, or `brew install llvm`)",
    command: "lldb-dap",
    args: [],
    ready: true,
    fallbacks: [
      "/usr/local/opt/llvm/bin/lldb-dap",
      "/opt/homebrew/opt/llvm/bin/lldb-dap",
      "/Library/Developer/CommandLineTools/usr/bin/lldb-dap",
    ],
    build: "cargo",
  },
  node: {
    id: "node",
    label: "Node (js-debug)",
    probe: "node",
    install: "the VS Code JavaScript debugger (js-debug) is required — not yet bundled",
    command: "node",
    args: [],
    ready: false,
  },
};

const EXT_TO_DEBUGGER: Record<string, DebuggerId> = {
  py: "python",
  rs: "rust",
  js: "node",
  mjs: "node",
  cjs: "node",
  ts: "node",
  tsx: "node",
  jsx: "node",
};

/** Which debugger fits a file, or null when none is known for it. */
export function debuggerForFile(path: string): DebuggerId | null {
  const ext = path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_DEBUGGER[ext] ?? null;
}

export interface LaunchConfig {
  request: "launch";
  type: DebuggerId;
  program: string;
  cwd: string;
  stopOnEntry?: boolean;
  args?: string[];
}

export function launchConfig(
  dbg: DebuggerId,
  program: string,
  cwd: string,
  args: string[] = [],
): LaunchConfig {
  return { request: "launch", type: dbg, program, cwd, stopOnEntry: false, args };
}

/** The `launch` body debugpy expects, whose field names differ from the generic
 *  config. Kept here so the session code stays protocol-shaped. */
export function debugpyLaunchBody(config: LaunchConfig): Record<string, unknown> {
  return {
    request: "launch",
    type: "python",
    program: config.program,
    cwd: config.cwd,
    args: config.args ?? [],
    stopOnEntry: config.stopOnEntry ?? false,
    console: "internalConsole",
    justMyCode: true,
  };
}

/** The `launch` body lldb-dap expects. Unlike debugpy, `program` is a compiled
 *  executable (resolved from `cargo build`), not a source file; breakpoints are
 *  still set against the `.rs` source and matched through the binary's DWARF.
 *  `initCommands` disables colour so the debug console output stays clean. */
export function lldbLaunchBody(config: LaunchConfig): Record<string, unknown> {
  return {
    request: "launch",
    program: config.program,
    args: config.args ?? [],
    cwd: config.cwd,
    stopOnEntry: config.stopOnEntry ?? false,
    initCommands: ["settings set use-color false"],
  };
}
