import { describe, expect, it } from "vitest";
import { buildVerify, grepPatternFor } from "./verifyspec";

describe("grep pattern for a claim", () => {
  it("prefers package-shaped names over every weaker class", () => {
    expect(grepPatternFor("Terminal uses @xterm/addon-fit and lucide-react 1.31")).toBe(
      "@xterm/addon-fit|lucide-react",
    );
  });

  it("falls back to a capitalised product when no package name is present", () => {
    expect(grepPatternFor("State management uses Zustand 5.0.15")).toBe("Zustand");
  });

  it("strips sentence punctuation that no manifest contains", () => {
    expect(grepPatternFor("The Rust crate is magnetar_lib.")).toBe("magnetar_lib");
  });

  it("escapes regex metacharacters so a version is a literal", () => {
    const pattern = grepPatternFor("pinned at 5.0.15");
    expect(pattern).toBe("5\\.0\\.15");
    expect(new RegExp(pattern!).test("5.0.15")).toBe(true);
    expect(new RegExp(pattern!).test("5a0b15")).toBe(false);
  });

  it("ranks a version above an ordinary long word", () => {
    expect(grepPatternFor("runtime pinned at 5.0.15")).toBe("5\\.0\\.15");
  });

  it("returns nothing rather than matching on filler words", () => {
    expect(grepPatternFor("The project uses all the local state management")).toBeUndefined();
    expect(grepPatternFor("a b c")).toBeUndefined();
    expect(grepPatternFor("")).toBeUndefined();
  });

  it("deduplicates and caps the alternation at three candidates", () => {
    const pattern = grepPatternFor("Deps: aaa-one bbb-two ccc-three ddd-four aaa-one");
    expect(pattern!.split("|")).toEqual(["aaa-one", "bbb-two", "ccc-three"]);
  });

  it("produces a pattern that matches the manifest it was derived from", () => {
    const pattern = grepPatternFor("State management uses Zustand 5.0.15")!;
    expect(new RegExp(pattern, "i").test('"zustand": "^5.0.15"')).toBe(true);
  });
});

describe("verify spec", () => {
  it("builds a grep spec only for an extracted stack fact with a source file", () => {
    expect(buildVerify(true, "stack", "Uses lucide-react", "package.json")).toEqual({
      kind: "grep",
      pattern: "lucide-react",
      file: "package.json",
    });
  });

  it("refuses to build a spec it could not honestly check", () => {
    expect(buildVerify(false, "stack", "Uses lucide-react", "package.json")).toBeUndefined();
    expect(buildVerify(true, "architecture", "Uses lucide-react", "package.json")).toBeUndefined();
    expect(buildVerify(true, "stack", "Uses lucide-react", undefined)).toBeUndefined();
    expect(buildVerify(true, "stack", "the local state", "package.json")).toBeUndefined();
  });
});
