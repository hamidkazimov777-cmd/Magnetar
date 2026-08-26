import { describe, expect, it } from "vitest";
import { resolveLeases } from "./leases";
import type { SubagentTask } from "./subagents";

const task = (title: string, files?: string[]): SubagentTask => ({
  title,
  instructions: title,
  files,
});

describe("file leases", () => {
  it("lets the first claimant keep a file and refuses the second with a reason", () => {
    const { accepted, refused } = resolveLeases(
      [task("rename api", ["src/api.ts"]), task("tidy api", ["src/api.ts"])],
      undefined,
    );
    expect(accepted.map((t) => t.title)).toEqual(["rename api"]);
    expect(refused).toHaveLength(1);
    expect(refused[0].title).toBe("tidy api");
    expect(refused[0].reason).toContain("rename api");
    expect(refused[0].reason).toContain("src/api.ts");
  });

  it("collides two spellings of the same file", () => {
    const { accepted, refused } = resolveLeases(
      [task("a", ["./src/api.ts"]), task("b", ["src/api.ts"])],
      "/repo",
    );
    expect(accepted.map((t) => t.title)).toEqual(["a"]);
    expect(refused[0].reason).toContain("/repo/src/api.ts");
  });

  it("keeps an absolute path absolute rather than nesting it under the root", () => {
    const { refused } = resolveLeases(
      [task("a", ["/etc/hosts"]), task("b", ["/etc/hosts"])],
      "/repo",
    );
    expect(refused[0].reason).toContain("/etc/hosts");
    expect(refused[0].reason).not.toContain("/repo/etc/hosts");
  });

  it("accepts disjoint tasks and tasks that declare no files at all", () => {
    const { accepted, refused } = resolveLeases(
      [task("a", ["src/a.ts"]), task("b", ["src/b.ts"]), task("c")],
      undefined,
    );
    expect(accepted).toHaveLength(3);
    expect(refused).toEqual([]);
  });

  it("refuses a later task on any single overlap, not only a full one", () => {
    const { accepted, refused } = resolveLeases(
      [task("a", ["src/a.ts", "src/shared.ts"]), task("b", ["src/b.ts", "src/shared.ts"])],
      undefined,
    );
    expect(accepted.map((t) => t.title)).toEqual(["a"]);
    expect(refused[0].reason).toContain("src/shared.ts");
  });

  it("does not claim files for a task it refused", () => {
    const { accepted } = resolveLeases(
      [task("a", ["src/a.ts"]), task("b", ["src/a.ts", "src/b.ts"]), task("c", ["src/b.ts"])],
      undefined,
    );
    expect(accepted.map((t) => t.title)).toEqual(["a", "c"]);
  });

  it("returns empty results for no tasks", () => {
    expect(resolveLeases([], "/repo")).toEqual({ accepted: [], refused: [] });
  });
});
