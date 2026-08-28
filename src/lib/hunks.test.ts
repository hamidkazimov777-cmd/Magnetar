import { describe, expect, it } from "vitest";
import { buildHunkPatch, parseFileDiff } from "./hunks";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;
 const w = 4;
@@ -10,2 +11,2 @@
-const old = 5;
+const renamed = 5;
 const keep = 6;`;

describe("splitting a file's diff", () => {
  it("keeps the preamble apart from the hunks", () => {
    const { preamble, hunks } = parseFileDiff(DIFF);
    // The preamble is what tells a patch which file it touches; losing the
    // +++ line means git cannot place the hunk.
    expect(preamble).toContain("+++ b/src/a.ts");
    expect(preamble).not.toContain("@@");
    expect(hunks).toHaveLength(2);
  });

  it("counts what each hunk adds and removes", () => {
    const { hunks } = parseFileDiff(DIFF);
    expect(hunks[0]).toMatchObject({ added: 1, removed: 0 });
    expect(hunks[1]).toMatchObject({ added: 1, removed: 1 });
  });

  it("keeps each hunk's header and body verbatim", () => {
    const { hunks } = parseFileDiff(DIFF);
    expect(hunks[0].header).toBe("@@ -1,3 +1,4 @@");
    expect(hunks[0].lines).toContain("+const y = 2;");
    expect(hunks[1].lines).toContain("-const old = 5;");
  });

  it("finds no hunks in an empty diff", () => {
    expect(parseFileDiff("").hunks).toEqual([]);
  });
});

describe("building a one-hunk patch", () => {
  it("is the preamble, the header, the body, and a closing newline", () => {
    const { preamble, hunks } = parseFileDiff(DIFF);
    const patch = buildHunkPatch(preamble, hunks[0]);
    // git apply rejects the last hunk of a patch that does not end in a
    // newline as corrupt.
    expect(patch.endsWith("\n")).toBe(true);
    expect(patch).toContain("+++ b/src/a.ts");
    expect(patch).toContain("@@ -1,3 +1,4 @@");
    expect(patch).toContain("+const y = 2;");
    // Only the first hunk's changes: the second must not ride along.
    expect(patch).not.toContain("renamed");
  });

  it("round-trips a hunk through parse and build unchanged", () => {
    const { preamble, hunks } = parseFileDiff(DIFF);
    const patch = buildHunkPatch(preamble, hunks[1]);
    const reparsed = parseFileDiff(patch);
    expect(reparsed.hunks).toHaveLength(1);
    expect(reparsed.hunks[0].header).toBe("@@ -10,2 +11,2 @@");
  });
});
