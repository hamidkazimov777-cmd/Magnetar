import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  debuggerForFile,
  launchConfig,
  lldbLaunchBody,
  debugpyLaunchBody,
} from "./adapters";

describe("choosing a debugger for a file", () => {
  it("routes .rs to the Rust adapter and .py to Python", () => {
    expect(debuggerForFile("/w/src/main.rs")).toBe("rust");
    expect(debuggerForFile("/w/app.py")).toBe("python");
  });

  it("returns null for a file no adapter claims", () => {
    expect(debuggerForFile("/w/README.md")).toBeNull();
  });
});

describe("the Rust adapter spec", () => {
  it("is ready, builds with cargo, and carries keg-only fallbacks", () => {
    const rust = ADAPTERS.rust;
    expect(rust.ready).toBe(true);
    expect(rust.build).toBe("cargo");
    expect(rust.fallbacks?.length).toBeGreaterThan(0);
  });
});

describe("launch bodies are adapter-shaped", () => {
  it("lldb-dap gets program/cwd/args but not python's fields", () => {
    const body = lldbLaunchBody(launchConfig("rust", "/w/target/debug/app", "/w"));
    expect(body).toMatchObject({ request: "launch", program: "/w/target/debug/app", cwd: "/w" });
    expect(body).not.toHaveProperty("justMyCode");
  });

  it("debugpy gets its own fields", () => {
    const body = debugpyLaunchBody(launchConfig("python", "/w/app.py", "/w"));
    expect(body).toMatchObject({ type: "python", justMyCode: true });
  });
});
