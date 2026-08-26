import { describe, expect, it } from "vitest";
import { newFact, parseVerify, renderFact, renderFacts } from "./facts";
import type { MemoryFact } from "./types";

const fact = (over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: "f1",
  projectId: "p1",
  kind: "stack",
  text: "Uses SQLite",
  origin: "extracted",
  originDetail: "Cargo.toml",
  status: "unverified",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("creating a fact", () => {
  it("is born unverified, trimmed and carrying its provenance", () => {
    const f = newFact("p1", "stack", "  Uses SQLite  ", "extracted", "Cargo.toml", {
      kind: "grep",
      pattern: "rusqlite",
      file: "Cargo.toml",
    });
    expect(f.text).toBe("Uses SQLite");
    expect(f.status).toBe("unverified");
    expect(f.checkedAt).toBeUndefined();
    expect(f.origin).toBe("extracted");
    expect(f.originDetail).toBe("Cargo.toml");
    expect(JSON.parse(f.verify!)).toEqual({
      kind: "grep",
      pattern: "rusqlite",
      file: "Cargo.toml",
    });
  });

  it("leaves verify unset when no spec was supplied", () => {
    expect(newFact("p1", "state", "Halfway through step 2", "user").verify).toBeUndefined();
  });
});

describe("parsing a verify spec", () => {
  it("accepts a complete grep or check spec", () => {
    expect(
      parseVerify(fact({ verify: '{"kind":"grep","pattern":"rusqlite","file":"Cargo.toml"}' })),
    ).toEqual({ kind: "grep", pattern: "rusqlite", file: "Cargo.toml" });
    expect(parseVerify(fact({ verify: '{"kind":"check","checkId":"cargo-check"}' }))).toEqual({
      kind: "check",
      checkId: "cargo-check",
    });
  });

  it("returns null for a missing, malformed or incomplete spec", () => {
    expect(parseVerify(fact())).toBeNull();
    expect(parseVerify(fact({ verify: "not json" }))).toBeNull();
    expect(parseVerify(fact({ verify: '{"kind":"grep","pattern":"rusqlite"}' }))).toBeNull();
    expect(parseVerify(fact({ verify: '{"kind":"check"}' }))).toBeNull();
    expect(parseVerify(fact({ verify: '{"kind":"other"}' }))).toBeNull();
    expect(parseVerify(fact({ verify: "null" }))).toBeNull();
  });
});

describe("rendering facts for the prompt", () => {
  it("states where a fact came from and whether a machine confirmed it", () => {
    expect(renderFact(fact({ status: "verified", checkedAt: Date.UTC(2026, 7, 26) }))).toBe(
      "- Uses SQLite  [read from Cargo.toml; verified 2026-08-26]",
    );
    expect(renderFact(fact({ origin: "user", originDetail: undefined }))).toContain(
      "stated by the user; unverified",
    );
    expect(renderFact(fact({ status: "stale" }))).toContain("STALE");
    expect(renderFact(fact({ status: "refuted" }))).toContain("do not rely on it");
  });

  it("treats a verified fact with no check date as unverified", () => {
    expect(renderFact(fact({ status: "verified" }))).toContain("unverified");
  });

  it("drops refuted facts and puts verified ones first inside a group", () => {
    const out = renderFacts([
      fact({ id: "a", text: "unconfirmed claim" }),
      fact({ id: "b", text: "confirmed claim", status: "verified", checkedAt: 1 }),
      fact({ id: "c", text: "false claim", status: "refuted" }),
    ]);
    expect(out).not.toContain("false claim");
    expect(out.indexOf("confirmed claim")).toBeLessThan(out.indexOf("unconfirmed claim"));
    expect(out).toContain("Stack:");
  });

  it("groups by kind and tells the model an unverified fact is only a claim", () => {
    const out = renderFacts([
      fact({ id: "a", kind: "architecture", text: "Layered core" }),
      fact({ id: "b", kind: "stack", text: "Uses SQLite" }),
    ]);
    expect(out.indexOf("Stack:")).toBeLessThan(out.indexOf("Architecture:"));
    expect(out).toContain("check it in the code first");
  });

  it("renders nothing at all when there is nothing usable", () => {
    expect(renderFacts([])).toBe("");
    expect(renderFacts([fact({ status: "refuted" })])).toBe("");
  });
});
