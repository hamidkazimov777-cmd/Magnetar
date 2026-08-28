import type { StateCreator } from "zustand";
import type { AgentRunSlice } from "./agentRun";
import type { AppSlice } from "./app";
import type { DebugSlice } from "./debug";
import type { DiagnosticsSlice } from "./diagnostics";
import type { EditorSlice } from "./editor";
import type { MemorySlice } from "./memory";
import type { ProjectsSlice } from "./projects";
import type { ProvidersSlice } from "./providers";
import type { SessionsSlice } from "./sessions";
import type { ShellSlice } from "./shell";
import type { WorkspaceSlice } from "./workspace";

/* ==========================================================================
   THE COMPOSED STORE TYPE

   Each domain owns its own slice; this is the sum of them. A slice is written
   against the whole `State` on purpose — `closeFolder` clears editor tabs,
   `revealInFile` opens one, `setActiveProject` re-points the live session —
   and those are real relationships, not leaks. What the split buys is that
   each domain's data and the actions that own it live in one readable file
   instead of one 1,300-line one.
   ========================================================================== */

export type State = ProvidersSlice &
  ShellSlice &
  WorkspaceSlice &
  EditorSlice &
  SessionsSlice &
  ProjectsSlice &
  MemorySlice &
  DiagnosticsSlice &
  AgentRunSlice &
  AppSlice &
  DebugSlice;

/** How every slice creator is typed: it may read and write the whole store,
 *  but it only declares the part it owns. */
export type Slice<T> = StateCreator<State, [["zustand/persist", unknown]], [], T>;
