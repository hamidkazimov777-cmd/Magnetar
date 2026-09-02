import { describe, expect, it } from "vitest";
import { parseCargoArtifacts, pickExecutable } from "./cargoBuild";

/* The value here is the parse of cargo's JSON line stream: warnings, progress
   and non-runnable artifacts are interleaved with the one line that names the
   binary, and picking the wrong line means debugging the wrong thing. */

const STREAM = [
  `{"reason":"compiler-artifact","target":{"name":"serde","kind":["lib"]},"executable":null}`,
  `warning: unused variable`,
  ``,
  `{"reason":"compiler-artifact","target":{"name":"app","kind":["bin"]},"executable":"/w/target/debug/app"}`,
  `{"reason":"compiler-artifact","target":{"name":"app","kind":["test"]},"executable":"/w/target/debug/deps/app-abc"}`,
  `{"reason":"build-finished","success":true}`,
].join("\n");

describe("parsing cargo artifacts", () => {
  it("keeps only compiler-artifact lines that produced an executable", () => {
    const arts = parseCargoArtifacts(STREAM);
    expect(arts.map((a) => a.executable)).toEqual([
      "/w/target/debug/app",
      "/w/target/debug/deps/app-abc",
    ]);
    // The lib (executable: null) and the non-JSON warning are dropped.
    expect(arts).toHaveLength(2);
  });

  it("ignores malformed JSON without throwing", () => {
    expect(parseCargoArtifacts(`{not json\n{"reason":"other"}`)).toEqual([]);
  });
});

describe("picking which binary to debug", () => {
  it("prefers a bin target over a test binary", () => {
    const arts = parseCargoArtifacts(STREAM);
    expect(pickExecutable(arts)).toBe("/w/target/debug/app");
  });

  it("matches a name hint when one is given", () => {
    const arts = [
      { executable: "/w/target/debug/one", name: "one", kinds: ["bin"] },
      { executable: "/w/target/debug/two", name: "two", kinds: ["bin"] },
    ];
    expect(pickExecutable(arts, "two")).toBe("/w/target/debug/two");
  });

  it("returns null when nothing runnable was built (a lib-only crate)", () => {
    expect(pickExecutable([])).toBeNull();
  });
});
