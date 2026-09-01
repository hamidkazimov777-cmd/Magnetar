import { describe, expect, it, vi } from "vitest";

// The module pulls in the store (and through it Tauri wrappers); stub the store
// so importing `clean` stays a pure-function test.
vi.mock("./store", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("./api", () => ({ api: {} }));

import { clean } from "./inlineCompletion";

describe("inline completion clean()", () => {
  it("passes plain code through untouched", () => {
    expect(clean("const x = 1;")).toBe("const x = 1;");
  });

  it("strips a wrapping markdown fence with a language tag", () => {
    expect(clean("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("strips a bare fence", () => {
    expect(clean("```\nfoo()\n```")).toBe("foo()");
  });

  it("drops a single leading newline that would push text off the cursor line", () => {
    expect(clean("\n  indented")).toBe("  indented");
  });
});
