import { describe, expect, it } from "vitest";
import {
  cargoTasks,
  packageRunner,
  parseJustfile,
  parseMakefile,
  parsePackageJson,
  parsePyproject,
  singleTestCommand,
  type Task,
} from "./tasks";

describe("package.json scripts", () => {
  it("turns every script into a runnable task and flags the test ones", () => {
    const tasks = parsePackageJson(
      JSON.stringify({ scripts: { build: "vite build", test: "vitest", "test:unit": "vitest run" } }),
    );
    expect(tasks.map((t) => t.command)).toEqual([
      "npm run build",
      "npm run test",
      "npm run test:unit",
    ]);
    expect(tasks.find((t) => t.label === "build")!.isTest).toBe(false);
    expect(tasks.find((t) => t.label === "test")!.isTest).toBe(true);
    expect(tasks.find((t) => t.label === "test:unit")!.isTest).toBe(true);
  });

  it("uses the runner the lockfile implies, not always npm", () => {
    // Running `npm run` in a pnpm project is how you get a lockfile war.
    expect(packageRunner(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(packageRunner(["yarn.lock"])).toBe("yarn");
    expect(packageRunner(["package-lock.json"])).toBe("npm");
    const tasks = parsePackageJson(JSON.stringify({ scripts: { dev: "vite" } }), "pnpm");
    expect(tasks[0].command).toBe("pnpm run dev");
  });

  it("survives a malformed package.json rather than throwing", () => {
    expect(parsePackageJson("{ not json")).toEqual([]);
    expect(parsePackageJson(JSON.stringify({}))).toEqual([]);
  });
});

describe("Makefile targets", () => {
  it("lists real targets and skips the ones nobody runs by name", () => {
    const tasks = parseMakefile(
      [
        "build:",
        "\tgo build",
        "test: build",
        "\tgo test ./...",
        ".PHONY: build test",
        "%.o: %.c",
        "VAR := value",
      ].join("\n"),
    );
    expect(tasks.map((t) => t.label)).toEqual(["build", "test"]);
    expect(tasks.find((t) => t.label === "test")!.isTest).toBe(true);
    // := is an assignment, not a target.
    expect(tasks.some((t) => t.label === "VAR")).toBe(false);
  });
});

describe("justfile recipes", () => {
  it("reads recipes at column zero, not their indented bodies", () => {
    const tasks = parseJustfile(
      ["build:", "    cargo build", "test target:", "    cargo test", "  echo indented:"].join("\n"),
    );
    expect(tasks.map((t) => t.label)).toEqual(["build", "test"]);
  });
});

describe("pyproject", () => {
  it("offers the runner the project configured", () => {
    expect(parsePyproject("[tool.pytest.ini_options]\n").map((t) => t.label)).toContain("pytest");
    expect(parsePyproject("[tool.ruff]\n").map((t) => t.label)).toContain("ruff");
  });

  it("falls back to pytest when nothing is declared", () => {
    const tasks = parsePyproject("[build-system]\n");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].command).toContain("pytest");
  });
});

describe("cargo", () => {
  it("offers the fixed verbs, with test and clippy marked as tests", () => {
    const labels = cargoTasks().map((t) => t.label);
    expect(labels).toContain("cargo test");
    expect(labels).toContain("cargo build");
    expect(cargoTasks().find((t) => t.label === "cargo test")!.isTest).toBe(true);
  });
});

describe("running one test", () => {
  const task = (source: Task["source"], command = "npm run test"): Task => ({
    command,
    label: "test",
    source,
    isTest: true,
  });

  it("builds a single-test selector per framework", () => {
    expect(singleTestCommand(task("cargo"), "parses_branches")).toBe("cargo test parses_branches");
    expect(singleTestCommand(task("python"), "test_login")).toBe('pytest -k "test_login"');
    // The -- separator is what gets the flag past the package manager to the runner.
    expect(singleTestCommand(task("npm"), "handles empty")).toBe(
      'npm run test -- -t "handles empty"',
    );
  });

  it("returns null for a source with no clean single-test selector", () => {
    expect(singleTestCommand(task("make"), "x")).toBeNull();
    expect(singleTestCommand(task("just"), "x")).toBeNull();
  });
});
