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

  it("normalises repeated commands and stops after the repeat limit", () => {
    expect(callSignature("run_bash", { command: "sleep 30 && echo 12345" })).toBe(
      "run_bash:sleep N && echo N",
    );
    const watch = newLoopWatch();
    expect(checkLoop(watch, "read_file", { path: "README.md" }, false)).toBeNull();
    expect(checkLoop(watch, "read_file", { path: "README.md" }, false)).toBeNull();
    expect(checkLoop(watch, "read_file", { path: "README.md" }, false)).toBeNull();
    expect(checkLoop(watch, "read_file", { path: "README.md" }, false)).toContain(
      "same call 4 times",
    );
  });
});
