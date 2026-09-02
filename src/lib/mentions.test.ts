import { describe, expect, it, vi } from "vitest";

// mentions.ts imports the tauri api and the store at module load; stub them so
// the pure expandSlash function can be tested in isolation.
vi.mock("./api", () => ({ api: {} }));
vi.mock("./store", () => ({ useStore: { getState: () => ({ workspaceRoot: null }) } }));

const { expandSlash, SLASH_COMMANDS } = await import("./mentions");

describe("slash commands", () => {
  it("offers exactly one /prompt command, not one per model", () => {
    const prompts = SLASH_COMMANDS.filter((c) => c.id.startsWith("/prompt"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe("/prompt");
  });

  it("includes the new commands", () => {
    const ids = SLASH_COMMANDS.map((c) => c.id);
    for (const id of ["/security", "/simplify", "/docs", "/commit", "/btw"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("expandSlash", () => {
  it("/prompt targets any named model from the text", () => {
    const out = expandSlash("/prompt gpt-4o a cat on a roof");
    expect(out).toContain("the gpt-4o model");
    expect(out).toContain("a cat on a roof");
    expect(out).toContain("<MagnetarPrompt>");
  });

  it("/prompt with no model falls back to a generic generator", () => {
    expect(expandSlash("/prompt")).toContain("the right generator");
    expect(expandSlash("/prompt ")).toContain("the right generator");
  });

  it("/btw expands to a read-only side question", () => {
    const out = expandSlash("/btw where is the auth handled");
    expect(out.toLowerCase()).toContain("do not change anything");
    expect(out).toContain("where is the auth handled");
  });

  it("/security and /commit expand to their instructions", () => {
    expect(expandSlash("/security").toLowerCase()).toContain("security");
    expect(expandSlash("/commit").toLowerCase()).toContain("commit");
  });

  it("plain text is returned unchanged", () => {
    expect(expandSlash("just a normal message")).toBe("just a normal message");
  });
});
