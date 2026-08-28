import type { StackFrame, Variable } from "../debug/session";
import type { Slice } from "./state";

/* ==========================================================================
   DEBUG STATE

   Breakpoints outlive a session — they are set while reading code, not only
   while debugging — so they are persisted. Everything else about a run is
   process, not canon: the call stack, the variables, the console, and whether
   a session is even running are gone the moment it ends, and none of it is
   saved.
   ========================================================================== */

export type DebugStatus = "idle" | "starting" | "running" | "paused" | "ended";

export interface ConsoleLine {
  text: string;
  category: string;
}

export interface DebugSlice {
  /** Breakpoint line numbers per absolute file path. Persisted. */
  breakpoints: Record<string, number[]>;
  toggleBreakpoint: (path: string, line: number) => void;
  clearBreakpoints: (path?: string) => void;

  debugStatus: DebugStatus;
  setDebugStatus: (status: DebugStatus) => void;
  /** Why execution stopped, for the UI to explain the pause. */
  stopReason?: string;
  setStopReason: (reason: string | undefined) => void;

  callStack: StackFrame[];
  setCallStack: (frames: StackFrame[]) => void;
  /** The frame whose variables are shown; defaults to the top. */
  activeFrame?: number;
  setActiveFrame: (id: number | undefined) => void;

  variables: Variable[];
  setVariables: (vars: Variable[]) => void;

  debugConsole: ConsoleLine[];
  pushConsole: (line: ConsoleLine) => void;
  clearConsole: () => void;

  watches: string[];
  addWatch: (expr: string) => void;
  removeWatch: (expr: string) => void;
}

export const createDebugSlice: Slice<DebugSlice> = (set) => ({
  breakpoints: {},
  toggleBreakpoint: (path, line) =>
    set((s) => {
      const lines = s.breakpoints[path] ?? [];
      const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
      const map = { ...s.breakpoints };
      if (next.length) map[path] = next;
      else delete map[path];
      return { breakpoints: map };
    }),
  clearBreakpoints: (path) =>
    set((s) => {
      if (!path) return { breakpoints: {} };
      const map = { ...s.breakpoints };
      delete map[path];
      return { breakpoints: map };
    }),

  debugStatus: "idle",
  setDebugStatus: (debugStatus) => set({ debugStatus }),
  setStopReason: (stopReason) => set({ stopReason }),

  callStack: [],
  setCallStack: (callStack) =>
    set({ callStack, activeFrame: callStack[0]?.id }),
  setActiveFrame: (activeFrame) => set({ activeFrame }),

  variables: [],
  setVariables: (variables) => set({ variables }),

  debugConsole: [],
  // Capped: a console is a recent view, not a log file, and an unbounded array
  // is a memory leak for a program that prints in a loop.
  pushConsole: (line) =>
    set((s) => ({ debugConsole: [...s.debugConsole, line].slice(-500) })),
  clearConsole: () => set({ debugConsole: [] }),

  watches: [],
  addWatch: (expr) =>
    set((s) => (s.watches.includes(expr) ? {} : { watches: [...s.watches, expr] })),
  removeWatch: (expr) => set((s) => ({ watches: s.watches.filter((w) => w !== expr) })),
});
