import type { CheckRun, Diag } from "../problems";
import type { Slice } from "./state";

/* ==========================================================================
   WHAT THE MACHINE SAYS IS WRONG

   Two sources, kept apart: the project's own checks (types, lint, tests),
   which the user runs, and live language-server diagnostics, which arrive on
   their own. Neither is persisted — both describe the working tree as it is
   right now, and a restored stale problem is worse than an empty panel.
   ========================================================================== */

export interface DiagnosticsSlice {
  /** Latest result per project check (types, lint, tests). */
  checkRuns: Record<string, CheckRun>;
  setCheckRun: (id: string, run: CheckRun) => void;

  /** Live language-server diagnostics, keyed by absolute file path. Only files
   *  that currently have diagnostics are present. */
  lspDiagnostics: Record<string, Diag[]>;
  setLspDiagnostics: (path: string, diags: Diag[]) => void;

  /** Language servers that were looked for and not found on PATH, keyed by
   *  server pool key. Drives the "server not installed" hint in the editor.
   *  Not persisted — it reflects the current machine. */
  lspMissing: Record<string, { label: string; install: string }>;
  setLspMissing: (key: string, info: { label: string; install: string } | null) => void;
}

export const createDiagnosticsSlice: Slice<DiagnosticsSlice> = (set) => ({
  checkRuns: {},
  setCheckRun: (id, run) =>
    set((s) => ({ checkRuns: { ...s.checkRuns, [id]: run } })),

  lspDiagnostics: {},
  setLspDiagnostics: (path, diags) =>
    set((s) => {
      const next = { ...s.lspDiagnostics };
      if (diags.length) next[path] = diags;
      else delete next[path];
      return { lspDiagnostics: next };
    }),

  lspMissing: {},
  setLspMissing: (key, info) =>
    set((s) => {
      const next = { ...s.lspMissing };
      if (info) next[key] = info;
      else delete next[key];
      return { lspMissing: next };
    }),
});
