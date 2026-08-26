import { describe, expect, it } from "vitest";
import { outlineOf, trailAt } from "./outline";

const names = (path: string, text: string) => outlineOf(path, text).map((s) => s.name);

describe("reading the shape of a TypeScript file", () => {
  it("finds the declarations people navigate by", () => {
    const out = outlineOf(
      "a.ts",
      [
        "export function parse(input: string) {}",
        "export class Reader {}",
        "interface Options {}",
        "type Kind = 'a' | 'b';",
      ].join("\n"),
    );
    expect(out.map((s) => [s.name, s.kind])).toEqual([
      ["parse", "function"],
      ["Reader", "class"],
      ["Options", "interface"],
      ["Kind", "type"],
    ]);
  });

  it("treats an arrow assigned to a const as the function it is", () => {
    // Most of a modern codebase declares its functions this way. Listing them
    // as constants would make the outline useless for the files people read
    // most.
    const out = outlineOf(
      "a.ts",
      [
        "export const load = async (path: string) => {};",
        "const helper = function () {};",
        "const MAX_ITEMS = 10;",
      ].join("\n"),
    );
    expect(out.map((s) => [s.name, s.kind])).toEqual([
      ["load", "function"],
      ["helper", "function"],
      ["MAX_ITEMS", "constant"],
    ]);
  });

  it("nests by indentation so a method sits under its class", () => {
    const out = outlineOf("a.ts", ["class Reader {", "  read() {}", "}"].join("\n"));
    expect(out[0].level).toBe(0);
    expect(out[1].level).toBeGreaterThan(0);
  });
});

describe("the other languages the app opens", () => {
  it("reads Rust", () => {
    expect(
      names(
        "a.rs",
        ["pub fn run() {}", "struct Index;", "pub trait Provider {}", "impl Index {"].join("\n"),
      ),
    ).toEqual(["run", "Index", "Provider", "Index"]);
  });

  it("reads Python by def and class", () => {
    expect(names("a.py", ["class Reader:", "    def read(self):", "        pass"].join("\n")))
      .toEqual(["Reader", "read"]);
  });

  it("keeps a Go method's receiver, because that is what says who owns it", () => {
    expect(names("a.go", ["func (r *Reader) Read() {}", "func New() {}"].join("\n"))).toEqual([
      "(r *Reader) Read",
      "New",
    ]);
  });

  it("reads shell functions", () => {
    expect(names("a.sh", ["main() {", "function helper() {"].join("\n"))).toEqual([
      "main",
      "helper",
    ]);
  });

  it("outlines markdown by heading, and ignores hashes inside a fence", () => {
    const out = outlineOf(
      "a.md",
      ["# Title", "```bash", "# not a heading", "```", "## Section"].join("\n"),
    );
    expect(out.map((s) => [s.name, s.level])).toEqual([
      ["Title", 0],
      ["Section", 1],
    ]);
  });

  it("outlines JSON and YAML by their top keys, and stops before the deep ones", () => {
    // A deep config listed in full is a second copy of the file, not a way
    // around it.
    expect(names("a.json", '{\n  "name": "x",\n  "scripts": {\n    "build": "vite"\n  }\n}')).toEqual([
      "name",
      "scripts",
    ]);
    expect(names("a.yml", ["jobs:", "  build:", "    steps:", "# comment:"].join("\n"))).toEqual([
      "jobs",
      "build",
    ]);
  });

  it("says nothing about a language it does not know", () => {
    expect(outlineOf("a.cobol", "IDENTIFICATION DIVISION.")).toEqual([]);
    expect(outlineOf("a.ts", "")).toEqual([]);
  });

  it("skips a minified line rather than reporting nonsense from it", () => {
    expect(outlineOf("a.js", `function a(){}${";".repeat(600)}`)).toEqual([]);
  });
});

describe("the trail to a line", () => {
  const source = [
    "export class Reader {", // 1
    "  read() {", //           2
    "    return 1;", //        3
    "  }", //                  4
    "}", //                    5
    "export function parse() {}", // 6
  ].join("\n");

  it("names the innermost declaration and its ancestors", () => {
    const trail = trailAt(outlineOf("a.ts", source), 3).map((s) => s.name);
    expect(trail).toEqual(["Reader", "read"]);
  });

  it("drops back to the top level when the cursor leaves", () => {
    expect(trailAt(outlineOf("a.ts", source), 6).map((s) => s.name)).toEqual(["parse"]);
  });

  it("is empty above the first declaration", () => {
    expect(trailAt(outlineOf("a.ts", source), 0)).toEqual([]);
  });
});
