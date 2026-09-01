import { api } from "../api";

/* ==========================================================================
   BUILDING A RUST TARGET BEFORE DEBUGGING IT

   A native debugger launches a compiled executable, not a source file, so
   debugging a `.rs` file means: build the package it belongs to, then find the
   binary cargo produced. `cargo build --message-format=json` prints one JSON
   object per line; the `compiler-artifact` records carry an `executable` path
   when a target compiled to a runnable binary. Parsing that stream is how the
   binary is found without guessing the `target/debug/<name>` layout, which a
   custom target dir, workspace or renamed binary would break.

   The parse is separated from the run so the line-protocol handling is testable
   without a toolchain.
   ========================================================================== */

export interface CargoArtifact {
  /** Absolute path to the runnable binary, when this target produced one. */
  executable: string;
  /** The target's name, e.g. the crate or the `[[bin]]` name. */
  name: string;
  /** target.kind — "bin", "test", "example"… — used to prefer a real binary. */
  kinds: string[];
}

/** Pull the runnable artifacts out of a `cargo build --message-format=json`
 *  stream. Non-JSON lines and non-artifact messages are ignored, so a stream
 *  interleaved with warnings or progress is fine. */
export function parseCargoArtifacts(stdout: string): CargoArtifact[] {
  const out: CargoArtifact[] = [];
  for (const line of stdout.split("\n")) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(s);
    } catch {
      continue;
    }
    if (msg.reason !== "compiler-artifact") continue;
    const exe = msg.executable;
    if (typeof exe !== "string" || exe.length === 0) continue;
    const target = (msg.target ?? {}) as { name?: string; kind?: string[] };
    out.push({
      executable: exe,
      name: target.name ?? "",
      kinds: Array.isArray(target.kind) ? target.kind : [],
    });
  }
  return out;
}

/** Choose which built binary to debug. A plain `bin` is preferred over a test
 *  or example; when a source file hints at a target name (its file stem, or
 *  `main`), a matching binary wins. Falls back to the last runnable artifact,
 *  which is cargo's final product. */
export function pickExecutable(
  artifacts: CargoArtifact[],
  hintName?: string,
): string | null {
  if (artifacts.length === 0) return null;
  const bins = artifacts.filter((a) => a.kinds.includes("bin"));
  const pool = bins.length ? bins : artifacts;
  if (hintName) {
    const named = pool.find((a) => a.name === hintName);
    if (named) return named.executable;
  }
  return pool[pool.length - 1].executable;
}

export interface BuildResult {
  ok: boolean;
  /** The executable to launch, when the build produced a runnable binary. */
  program?: string;
  /** A short, already-trimmed reason when the build cannot be debugged. */
  error?: string;
}

/** Build the Rust package that owns `filePath` and resolve the binary to debug.
 *  `cargo` is run from the file's directory so it finds the right package in a
 *  workspace; cargo itself walks up to the enclosing `Cargo.toml`. */
export async function buildRustTarget(filePath: string): Promise<BuildResult> {
  const dir = filePath.replace(/\/[^/]*$/, "") || "/";
  const stem = filePath.split("/").pop()?.replace(/\.rs$/, "") ?? "";
  const hint = stem === "main" || stem === "lib" ? undefined : stem;

  const res = await api
    .toolRunBash("cargo build --message-format=json", dir, 600)
    .catch((e: unknown) => ({ stdout: "", stderr: String(e), code: 1, truncated: false }));

  if (res.code !== 0) {
    // The human-readable compiler errors are on stderr; surface the first,
    // trimmed, so a failing build reads as a build failure and not a debugger
    // one.
    const firstError =
      res.stderr
        .split("\n")
        .find((l) => l.trimStart().startsWith("error")) ?? res.stderr.trim();
    return { ok: false, error: firstError.slice(0, 200) || "cargo build failed" };
  }

  const program = pickExecutable(parseCargoArtifacts(res.stdout), hint);
  if (!program) {
    return {
      ok: false,
      error: "no runnable binary — Rust debugging needs a bin target (a main.rs)",
    };
  }
  return { ok: true, program };
}

/** Resolve a debug-adapter command to an absolute path: the one on PATH if
 *  present, otherwise the first executable among the spec's known fallbacks.
 *  Returns null when nothing is found. */
export async function resolveAdapterCommand(
  command: string,
  fallbacks: string[] = [],
  cwd?: string,
): Promise<string | null> {
  const onPath = await api.lspWhich(command).catch(() => null);
  if (onPath) return command;
  if (fallbacks.length === 0) return null;
  // A single shell test keeps this to one round-trip: echo the first fallback
  // that exists and is executable.
  const probe = fallbacks.map((p) => `[ -x "${p}" ] && { echo "${p}"; exit 0; }`).join("; ");
  const res = await api
    .toolRunBash(probe, cwd, 10)
    .catch(() => ({ stdout: "", stderr: "", code: 1, truncated: false }));
  const hit = res.stdout.trim().split("\n")[0]?.trim();
  return hit && hit.length > 0 ? hit : null;
}
