/* ==========================================================================
   TASKS THE PROJECT ALREADY DEFINES

   Every project carries its runnable commands somewhere — package.json scripts,
   Cargo, a Makefile, pyproject, a justfile. The point is not to invent a task
   system but to surface the one the project already has, so "run the tests" is
   a click rather than a remembered incantation typed into the terminal.

   Discovery is parsing, and parsing is where this quietly lists a target that
   does not exist or misses one that does — so the parsers are pure functions
   over the file text, with tests, and the running is a thin layer that hands
   the chosen command to the terminal.
   ========================================================================== */

export type TaskSource = "npm" | "cargo" | "make" | "python" | "just";

export interface Task {
  /** What runs, verbatim, so the terminal shows the user exactly what ran. */
  command: string;
  /** A short human label: the script name, the target, "cargo test". */
  label: string;
  source: TaskSource;
  /** True when this looks like a test task — it gets a run-single affordance. */
  isTest: boolean;
}

import { api } from "./api";

const looksLikeTest = (name: string): boolean => /(^|[:\-_ ])(test|spec|check|lint)/i.test(name);

/** Which package manager a JS project uses, from its lockfile, so the run
 *  command matches how the project is actually built rather than assuming npm. */
export function packageRunner(lockfiles: string[]): "npm" | "pnpm" | "yarn" | "bun" {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("bun.lockb")) return "bun";
  return "npm";
}

export function parsePackageJson(text: string, runner = "npm"): Task[] {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(text);
  } catch {
    return [];
  }
  const run = runner === "npm" ? "npm run" : runner === "yarn" ? "yarn" : `${runner} run`;
  return Object.keys(pkg.scripts ?? {}).map((name) => ({
    command: `${run} ${name}`,
    label: name,
    source: "npm",
    isTest: looksLikeTest(name),
  }));
}

/** Cargo's tasks are fixed verbs, not declared, so they are offered when a
 *  Cargo.toml exists rather than parsed out of it. */
export function cargoTasks(): Task[] {
  return [
    { command: "cargo build", label: "cargo build", source: "cargo", isTest: false },
    { command: "cargo test", label: "cargo test", source: "cargo", isTest: true },
    { command: "cargo clippy", label: "cargo clippy", source: "cargo", isTest: true },
    { command: "cargo run", label: "cargo run", source: "cargo", isTest: false },
  ];
}

/** Makefile targets: lines like `build:` at column zero, skipping the special
 *  and pattern ones that are not things a person runs directly. */
export function parseMakefile(text: string): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/.exec(line);
    if (!m) continue;
    const name = m[1];
    if (name.startsWith(".") || name.includes("%") || seen.has(name)) continue;
    seen.add(name);
    out.push({ command: `make ${name}`, label: name, source: "make", isTest: looksLikeTest(name) });
  }
  return out;
}

/** justfile recipes: `name:` or `name arg:` at column zero. */
export function parseJustfile(text: string): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    // Recipes start at column zero; an indented line is a recipe body.
    const m = /^([a-zA-Z0-9][a-zA-Z0-9_-]*)(?:\s+[^:]*)?:/.exec(line);
    if (!m || line.startsWith(" ") || line.startsWith("\t")) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ command: `just ${name}`, label: name, source: "just", isTest: looksLikeTest(name) });
  }
  return out;
}

/** pyproject: offer the test runner the project actually configured, rather
 *  than guessing pytest into a project that uses unittest. */
export function parsePyproject(text: string): Task[] {
  const out: Task[] = [];
  if (/\[tool\.pytest/.test(text) || /pytest/.test(text)) {
    out.push({ command: "pytest", label: "pytest", source: "python", isTest: true });
  }
  if (/\[tool\.poetry/.test(text)) {
    out.push({ command: "poetry install", label: "poetry install", source: "python", isTest: false });
  }
  if (/\[tool\.ruff/.test(text)) {
    out.push({ command: "ruff check .", label: "ruff", source: "python", isTest: true });
  }
  // Nothing declared but a pyproject exists: unittest is always available.
  if (out.length === 0) {
    out.push({ command: "python -m pytest", label: "pytest", source: "python", isTest: true });
  }
  return out;
}

/** How a test framework runs one test by name, so "run this test" is possible
 *  and not only "run the suite". Returns null when the framework has no clean
 *  single-test selector we can build without guessing. */
export function singleTestCommand(task: Task, testName: string): string | null {
  switch (task.source) {
    case "cargo":
      // cargo test takes a substring filter as a positional argument.
      return `cargo test ${testName}`;
    case "python":
      return `pytest -k ${JSON.stringify(testName)}`;
    case "npm":
      // Vitest and Jest both accept -t; passing it through the script needs the
      // `--` separator so it reaches the runner, not the package manager.
      return `${task.command} -- -t ${JSON.stringify(testName)}`;
    default:
      return null;
  }
}


/** Read the project's manifests and return every task they define.
 *
 *  A missing file is not an error — a Rust project has no package.json — so
 *  each read is guarded and contributes nothing when it is not there. Order
 *  puts the project's own scripts first, because those encode its intent, and
 *  the fixed cargo/python verbs after.
 */
export async function discoverTasks(root: string): Promise<Task[]> {
  const read = async (name: string): Promise<string | null> => {
    try {
      return await api.editorReadFile(`${root}/${name}`);
    } catch {
      return null;
    }
  };

  const tasks: Task[] = [];

  const pkg = await read("package.json");
  if (pkg) {
    // The lockfile decides the runner; list the ones that exist.
    const lockfiles = (
      await Promise.all(
        ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "package-lock.json"].map(async (f) =>
          (await read(f)) !== null ? f : null,
        ),
      )
    ).filter((f): f is string => f !== null);
    tasks.push(...parsePackageJson(pkg, packageRunner(lockfiles)));
  }

  if ((await read("Cargo.toml")) !== null) tasks.push(...cargoTasks());

  const makefile = (await read("Makefile")) ?? (await read("makefile"));
  if (makefile) tasks.push(...parseMakefile(makefile));

  const justfile = (await read("justfile")) ?? (await read("Justfile"));
  if (justfile) tasks.push(...parseJustfile(justfile));

  const pyproject = await read("pyproject.toml");
  if (pyproject) tasks.push(...parsePyproject(pyproject));

  return tasks;
}
