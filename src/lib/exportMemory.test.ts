import { describe, expect, it } from "vitest";
import { planImport } from "./exportMemory";
import type { MemoryFact } from "./types";

const existing = (text: string): MemoryFact => ({
  id: "e1",
  projectId: "p1",
  kind: "stack",
  text,
  origin: "user",
  status: "verified",
  checkedAt: 5,
  createdAt: 1,
  updatedAt: 1,
});

const snapshot = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ facts: [], decisions: [], ...over });

describe("reading a memory export back", () => {
  it("brings facts in as new memory belonging to the open project", () => {
    const plan = planImport(
      snapshot({ facts: [{ kind: "stack", text: "Uses SQLite" }] }),
      "p2",
      [],
    );
    expect(plan.facts).toHaveLength(1);
    expect(plan.facts[0].projectId).toBe("p2");
    expect(plan.facts[0].text).toBe("Uses SQLite");
  });

  it("never carries a verification across machines", () => {
    // The file may say a fact was verified. That was true somewhere else, at
    // some other time, against some other checkout.
    const plan = planImport(
      snapshot({ facts: [{ kind: "stack", text: "Uses SQLite", status: "verified", checkedAt: 9 }] }),
      "p1",
      [],
    );
    expect(plan.facts[0].status).toBe("unverified");
    expect(plan.facts[0].checkedAt).toBeUndefined();
    expect(plan.facts[0].originDetail).toBe("imported");
  });

  it("adds rather than overwrites, and says what it skipped", () => {
    // Someone restoring after losing work must not have the file win silently
    // over whatever survived.
    const plan = planImport(
      snapshot({ facts: [{ text: "Uses SQLite" }, { text: "New claim" }] }),
      "p1",
      [existing("Uses SQLite")],
    );
    expect(plan.facts.map((f) => f.text)).toEqual(["New claim"]);
    expect(plan.skipped.join(" ")).toContain("already known");
  });

  it("drops duplicates inside the file itself", () => {
    const plan = planImport(
      snapshot({ facts: [{ text: "Same thing" }, { text: "same thing" }] }),
      "p1",
      [],
    );
    expect(plan.facts).toHaveLength(1);
  });

  it("keeps decisions with their reasoning", () => {
    const plan = planImport(
      snapshot({ decisions: [{ title: "Use SQLite", rationale: "local, no server" }] }),
      "p1",
      [],
    );
    expect(plan.decisions[0]).toMatchObject({
      projectId: "p1",
      title: "Use SQLite",
      rationale: "local, no server",
      origin: "legacy",
    });
  });

  it("skips empty rows instead of importing blanks", () => {
    const plan = planImport(
      snapshot({ facts: [{ text: "  " }, { kind: "stack" }], decisions: [{ rationale: "why" }] }),
      "p1",
      [],
    );
    expect(plan.facts).toEqual([]);
    expect(plan.decisions).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
  });

  it("refuses a file that is not an export, with a reason a person can act on", () => {
    expect(() => planImport("not json", "p1", [])).toThrow(/not valid JSON/);
    expect(() => planImport("{}", "p1", [])).toThrow(/no facts/);
    expect(() => planImport('{"facts":"nope"}', "p1", [])).toThrow(/no facts/);
  });

  it("takes an unknown kind as architecture rather than refusing the row", () => {
    const plan = planImport(snapshot({ facts: [{ kind: "nonsense", text: "A claim" }] }), "p1", []);
    expect(plan.facts[0].kind).toBe("architecture");
  });
});
