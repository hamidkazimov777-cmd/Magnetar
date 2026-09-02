import { describe, expect, it } from "vitest";
import {
  alwaysConfirm,
  callSignature,
  checkLoop,
  isSecretPath,
  newLoopWatch,
} from "./guards";

describe("agent guards", () => {
  it("recognises credential paths but allows templates", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath("config/production.pem")).toBe(true);
    expect(isSecretPath(".env.example")).toBe(false);
    expect(isSecretPath("src/main.ts")).toBe(false);
  });

  it("requires confirmation for dangerous writes and shell commands", () => {
    expect(alwaysConfirm("write_file", { path: ".env" })).toBe(true);
    expect(alwaysConfirm("write_file", { path: ".env.example" })).toBe(false);
    expect(alwaysConfirm("run_bash", { command: "git reset --hard" })).toBe(true);
    expect(alwaysConfirm("run_bash", { command: "git status" })).toBe(false);
  });

  it("normalises repeated commands", () => {
    expect(callSignature("run_bash", { command: "sleep 30 && echo 12345" })).toBe(
      "run_bash:sleep N && echo N",
    );
  });

  it("stops the same call returning the same result after the repeat limit", () => {
    const watch = newLoopWatch();
    const same = () => checkLoop(watch, "read_file", { path: "README.md" }, "identical", false);
    expect(same()).toBeNull();
    expect(same()).toBeNull();
    expect(same()).toBeNull();
    expect(same()).toContain("same call 4 times");
  });

  it("does NOT stop a polling loop whose result keeps changing (a growing log)", () => {
    // sleep N && tail log — the command normalises to one signature, but the
    // log grows so each result differs: this is progress, not a loop.
    const watch = newLoopWatch();
    const args = { command: "sleep 5 && tail -5 /tmp/build.log" };
    for (let i = 0; i < 8; i++) {
      const growing = `line ${i}\nline ${i + 1}\ncompiling crate ${i}`;
      expect(checkLoop(watch, "run_bash", args, growing, false)).toBeNull();
    }
  });

  it("stops after too many consecutive failures regardless of result", () => {
    const watch = newLoopWatch();
    let last: string | null = null;
    for (let i = 0; i < 5; i++) {
      last = checkLoop(watch, "run_bash", { command: `try-${i}` }, `error: ${i}`, true);
    }
    expect(last).toContain("in a row failed");
  });
});
