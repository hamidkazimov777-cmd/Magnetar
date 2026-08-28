import { describe, expect, it } from "vitest";
import { ADAPTERS, debuggerForFile, debugpyLaunchBody, launchConfig } from "./adapters";

describe("choosing a debugger for a file", () => {
  it("maps extensions to their debugger", () => {
    expect(debuggerForFile("main.py")).toBe("python");
    expect(debuggerForFile("app.js")).toBe("node");
    expect(debuggerForFile("src/a.ts")).toBe("node");
    expect(debuggerForFile("readme.md")).toBeNull();
    expect(debuggerForFile("noext")).toBeNull();
  });
});

describe("adapter readiness is stated, not implied", () => {
  it("marks python ready and node as needing its adapter", () => {
    // A debugger that claims to work and then cannot is worse than one that
    // says up front what it needs.
    expect(ADAPTERS.python.ready).toBe(true);
    expect(ADAPTERS.node.ready).toBe(false);
    expect(ADAPTERS.python.install).toContain("debugpy");
  });
});

describe("building a launch config", () => {
  it("runs the program in the workspace, where its relative paths resolve", () => {
    const config = launchConfig("python", "/repo/main.py", "/repo", ["--verbose"]);
    expect(config).toMatchObject({
      request: "launch",
      type: "python",
      program: "/repo/main.py",
      cwd: "/repo",
      args: ["--verbose"],
    });
  });

  it("shapes the debugpy body with the field names it expects", () => {
    const body = debugpyLaunchBody(launchConfig("python", "/repo/main.py", "/repo"));
    expect(body).toMatchObject({
      request: "launch",
      type: "python",
      program: "/repo/main.py",
      cwd: "/repo",
      console: "internalConsole",
    });
  });
});
