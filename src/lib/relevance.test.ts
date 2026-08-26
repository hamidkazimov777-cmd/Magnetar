import { describe, expect, it } from "vitest";
import { pickMemory, similarity, tokens } from "./relevance";
import type { Decision, MemoryFact } from "./types";

const fact = (overrides: Partial<MemoryFact>): MemoryFact => ({
  id: "f-1",
  projectId: "p-1",
  kind: "architecture",
  text: "The project uses SQLite for the canonical transcript.",
  origin: "extracted",
  status: "verified",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const decision = (overrides: Partial<Decision>): Decision => ({
  id: "d-1",
  projectId: "p-1",
  title: "Keep the canon provider-neutral",
  origin: "user",
  createdAt: 1,
  ...overrides,
});

describe("memory relevance", () => {
  it("tokenises Cyrillic and removes common stop words", () => {
    expect(tokens("Что использует SQLite для проекта?"))
      .toEqual(["использует", "sqlite", "проекта"]);
  });

  it("scores overlapping text and excludes refuted facts", () => {
    expect(similarity("SQLite canon", "SQLite is the project canon")).toBeGreaterThan(0);
    const result = pickMemory(
      [
        fact({ id: "good", text: "SQLite is the canonical database." }),
        fact({ id: "bad", text: "The project uses a remote database.", status: "refuted" }),
      ],
      [decision({ id: "d-new", createdAt: 2 })],
      "database canon",
    );
    expect(result.facts.map((x) => x.id)).toEqual(["good"]);
    expect(result.decisions[0]?.id).toBe("d-new");
  });

  it("respects a hard character budget", () => {
    const result = pickMemory(
      [fact({ text: "a".repeat(200) }), fact({ id: "f-2", text: "b".repeat(200) })],
      [],
      "database",
      { budget: 100 },
    );
    expect(result.facts).toHaveLength(0);
  });
});
