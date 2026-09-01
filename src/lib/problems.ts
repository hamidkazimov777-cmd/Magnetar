import { api } from "./api";
import { toAppError } from "./errors";

/* ==========================================================================
   PROJECT CHECKS

   The piece an IDE has and a chat window does not: a way to ask the project
   "is anything broken?" and get a list you can click. Magnetar already has a
   shell (tool_run_bash), so this is a thin layer on top — discover the checks a
   project actually supports, run them, and parse compiler/linter output into
   file/line entries.
   ========================================================================== */

export interface Problem {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** Rule id or error code, when the tool reports one (TS2345, no-unused-vars). */
  code?: string;
}

/** A live language-server diagnostic. Like a Problem but with an end position
 *  (Monaco already has the file via the model, so no `file` here — the store
 *  keys these by path). */
export interface Diag {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string;
}

export interface Check {
  id: string;
  label: string;
  command: string;
}

export interface CheckRun {
  checkId: string;
  status: "idle" | "running" | "ok" | "failed" | "error";
  problems: Problem[];
  /** Raw tail of the output, shown when nothing could be parsed. */
  output?: string;
  at?: number;
  durationMs?: number;
}

/** Work out which checks this project supports.
 *
 *  Scripts in package.json win, because they encode the project's own opinion
 *  (a repo with `lint:ci` means that, not a guessed eslint invocation). Rust
 *  projects get the cargo equivalents. Nothing is invented: if a project has no
 *  scripts and no Cargo.toml, the list comes back empty rather than offering
 *  commands that would just fail. */
export async function discoverChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];

  let pkg: { scripts?: Record<string, string> } | null = null;
  try {
    pkg = JSON.parse(await api.editorReadFile(`${root}/package.json`));
  } catch {
    /* not a node project */
  }

  if (pkg?.scripts) {
    const s = pkg.scripts;
    const pick = (names: string[]) => names.find((n) => s[n]);

    const typecheck = pick(["typecheck", "type-check", "tsc", "check-types"]);
    if (typecheck) {
      checks.push({
        id: "types",
        label: "TypeScript",
        command: `npm run ${typecheck}`,
      });
    } else if (s.build?.includes("tsc") || (await exists(root, "tsconfig.json"))) {
      // No dedicated script, but the project is TypeScript — tsc knows how to
      // check without emitting, and that is exactly what we want here.
      // --no-install matters: plain `npx tsc` in a project without a local
      // TypeScript will happily download an unrelated 2016 package named "tsc"
      // and run that instead. Better to fail loudly.
      checks.push({
        id: "types",
        label: "TypeScript",
        command: "npx --no-install tsc --noEmit",
      });
    }

    const lint = pick(["lint", "eslint"]);
    if (lint) checks.push({ id: "lint", label: "Lint", command: `npm run ${lint}` });

    const test = pick(["test", "tests"]);
    if (test) checks.push({ id: "test", label: "Tests", command: `npm run ${test}` });
  }

  if (await exists(root, "Cargo.toml")) {
    checks.push({ id: "cargo", label: "cargo check", command: "cargo check --message-format short" });
    checks.push({ id: "clippy", label: "clippy", command: "cargo clippy --message-format short" });
  }
  if (await exists(root, "src-tauri/Cargo.toml") && !checks.some((c) => c.id === "cargo")) {
    checks.push({
      id: "cargo",
      label: "cargo check",
      command: "cargo check --manifest-path src-tauri/Cargo.toml --message-format short",
    });
  }

  return checks;
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await api.editorReadFile(`${root}/${rel}`);
    return true;
  } catch {
    return false;
  }
}

/** Run one check and turn its output into problems. */
export async function runCheck(
  root: string,
  check: Check,
  timeoutSecs = 300,
): Promise<CheckRun> {
  const started = Date.now();
  try {
    const r = await api.toolRunBash(check.command, root, timeoutSecs);
    const combined = `${r.stdout}\n${r.stderr}`;
    const problems = parseProblems(combined, root);
    return {
      checkId: check.id,
      // Exit code is the source of truth for pass/fail; problems may be empty
      // even on failure (a crashed test runner, an unparsed format).
      status: r.code === 0 ? "ok" : "failed",
      problems,
      output: problems.length ? undefined : tail(combined),
      at: Date.now(),
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      checkId: check.id,
      status: "error",
      problems: [],
      output: toAppError(e, `check:${check.id}`).message,
      at: Date.now(),
      durationMs: Date.now() - started,
    };
  }
}

function tail(s: string, lines = 40): string {
  const t = s.trim().split("\n");
  return t.slice(-lines).join("\n");
}

/* --------------------------------------------------------------------------
   Output parsing

   One pass over the lines, trying each known shape. Anything unrecognised is
   left alone and surfaced as raw output rather than guessed at.
   -------------------------------------------------------------------------- */

// src/lib/store.ts(12,5): error TS2345: Argument of type ...
const TSC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+):\s+(.*)$/;
// /abs/path/file.ts:12:5: error: message   (generic tools, vite, esbuild)
const GENERIC = /^(.+?):(\d+):(\d+):?\s+(error|warning|note)?:?\s+(.*)$/i;
// ESLint stylish: a bare path line, then "  12:5  error  msg  rule-name"
const ESLINT_POS = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s\s+([\w@/-]+))?\s*$/;
const PATHLIKE = /^(?:\.\/|\/|[A-Za-z]:\\)?[\w.@/\\-]+\.[a-zA-Z]{1,6}$/;
// cargo --message-format short: src/main.rs:12:5: error[E0308]: mismatched types
const CARGO = /^(.+?\.rs):(\d+):(\d+):\s+(error|warning)(?:\[([A-Z0-9]+)\])?:\s+(.*)$/;

export function parseProblems(output: string, root?: string): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  let eslintFile: string | null = null;

  const push = (p: Problem) => {
    const key = `${p.file}:${p.line}:${p.column}:${p.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(p);
  };

  const abs = (f: string) => {
    const clean = f.replace(/^\.\//, "").trim();
    if (!root || clean.startsWith("/") || /^[A-Za-z]:\\/.test(clean)) return clean;
    return `${root}/${clean}`;
  };

  for (const raw of output.split("\n")) {
    // ANSI colour codes are exactly the control characters we strip here.
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
    if (!line.trim()) continue;

    let m = CARGO.exec(line);
    if (m) {
      push({
        file: abs(m[1]),
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4] === "error" ? "error" : "warning",
        code: m[5],
        message: m[6],
      });
      continue;
    }

    m = TSC.exec(line);
    if (m) {
      push({
        file: abs(m[1]),
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4] === "error" ? "error" : "warning",
        code: m[5],
        message: m[6],
      });
      continue;
    }

    // ESLint prints the file on its own line, then indented positions under it.
    const posMatch = ESLINT_POS.exec(line);
    if (posMatch && eslintFile) {
      push({
        file: abs(eslintFile),
        line: Number(posMatch[1]),
        column: Number(posMatch[2]),
        severity: posMatch[3] === "error" ? "error" : "warning",
        message: posMatch[4].trim(),
        code: posMatch[5],
      });
      continue;
    }
    if (PATHLIKE.test(line.trim())) {
      eslintFile = line.trim();
      continue;
    }

    m = GENERIC.exec(line);
    if (m && /\.[a-zA-Z]{1,6}$/.test(m[1].trim())) {
      push({
        file: abs(m[1]),
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4]?.toLowerCase() === "warning" ? "warning" : "error",
        message: m[5],
      });
    }
  }

  return problems;
}
