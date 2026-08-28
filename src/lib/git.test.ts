import { describe, expect, it } from "vitest";
import {
  gitError,
  parseBlame,
  parseBranches,
  parseConflicts,
  parseLog,
  parseRemotes,
  parseStashes,
} from "./git";

const N = "\x00";

describe("parsing branches", () => {
  it("marks the current branch and reads its tracking", () => {
    const out = parseBranches(
      [
        `*${N}refs/heads/main${N}origin/main${N}[ahead 2, behind 1]`,
        ` ${N}refs/heads/feature${N}${N}`,
        ` ${N}refs/remotes/origin/main${N}${N}`,
      ].join("\n"),
    );
    expect(out.map((b) => b.name)).toEqual(["main", "feature", "origin/main"]);
    const main = out[0];
    expect(main.current).toBe(true);
    expect(main.upstream).toBe("origin/main");
    expect(main.ahead).toBe(2);
    expect(main.behind).toBe(1);
    expect(out[1].current).toBe(false);
    expect(out[2].remote).toBe(true);
  });

  it("drops the origin/HEAD pointer, which is not a branch anyone picks", () => {
    const out = parseBranches(
      [
        ` ${N}refs/remotes/origin/HEAD${N}${N} -> origin/main`,
        ` ${N}refs/remotes/origin/main${N}${N}`,
      ].join("\n"),
    );
    expect(out.map((b) => b.name)).toEqual(["origin/main"]);
  });

  it("does not mistake a branch literally named with a marker for the current one", () => {
    // The %(HEAD) field is exactly `*` or a space; a branch whose name contains
    // one cannot forge it, which is why the format is used over `branch -a`.
    const out = parseBranches(` ${N}refs/heads/star*branch${N}${N}`);
    expect(out[0].current).toBe(false);
    expect(out[0].name).toBe("star*branch");
  });
});

describe("parsing conflicts", () => {
  it("reads unmerged paths from porcelain v2, and nothing else", () => {
    const status = [
      "1 M. N... 100644 100644 100644 aaa bbb src/kept.ts",
      "u UU N... 100644 100644 100644 100644 h1 h2 h3 src/conflict.ts",
      "? untracked.ts",
    ].join("\n");
    expect(parseConflicts(status)).toEqual(["src/conflict.ts"]);
  });

  it("keeps a path with spaces intact", () => {
    const status = "u UU N... 100644 100644 100644 100644 h1 h2 h3 a file.ts";
    expect(parseConflicts(status)).toEqual(["a file.ts"]);
  });

  it("finds nothing in a clean tree", () => {
    expect(parseConflicts("1 M. N... 100644 100644 100644 a b file.ts")).toEqual([]);
  });
});

describe("parsing stashes", () => {
  it("keeps the index the user never sees, and the branch", () => {
    const out = parseStashes(
      ["stash@{0}: WIP on main: 1a2b3c fix", "stash@{1}: On feature: my note"].join("\n"),
    );
    expect(out[0]).toMatchObject({ index: 0, branch: "main" });
    expect(out[1]).toMatchObject({ index: 1, branch: "feature" });
    expect(out[1].message).toContain("my note");
  });

  it("is empty when there are no stashes", () => {
    expect(parseStashes("")).toEqual([]);
  });
});

describe("parsing blame", () => {
  it("pairs each line with who last touched it and when", () => {
    const porcelain = [
      "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 12 12 1",
      "author Ada Lovelace",
      "author-time 1700000000",
      "\tconst x = 1;",
    ].join("\n");
    const out = parseBlame(porcelain);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      author: "Ada Lovelace",
      time: 1700000000,
      line: 12,
      content: "const x = 1;",
    });
    expect(out[0].sha).toHaveLength(40);
  });

  it("carries a repeated commit's author across the lines it abbreviates", () => {
    // Porcelain only repeats author metadata for a sha it has not shown before;
    // subsequent lines from the same commit give only the sha header.
    const porcelain = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1",
      "author Ada",
      "author-time 100",
      "\tline one",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2 1",
      "\tline two",
    ].join("\n");
    const out = parseBlame(porcelain);
    expect(out.map((l) => l.content)).toEqual(["line one", "line two"]);
    expect(out[1].author).toBe("Ada");
  });
});

describe("parsing log", () => {
  it("splits the fields that a subject line could otherwise break", () => {
    // A subject with a NUL-safe separator survives a subject containing colons,
    // pipes and other things a delimiter guess would trip on.
    const out = parseLog(
      `abc123def456${N}abc123d${N}fix: a: b | c${N}Ada Lovelace${N}1700000000`,
    );
    expect(out[0]).toMatchObject({
      shortSha: "abc123d",
      subject: "fix: a: b | c",
      author: "Ada Lovelace",
      time: 1700000000,
    });
  });
});

describe("parsing remotes", () => {
  it("returns each remote once, by its fetch url", () => {
    const out = parseRemotes(
      [
        "origin\thttps://example.com/repo.git (fetch)",
        "origin\thttps://example.com/repo.git (push)",
        "upstream\thttps://example.com/up.git (fetch)",
        "upstream\thttps://example.com/up.git (push)",
      ].join("\n"),
    );
    expect(out).toEqual([
      { name: "origin", fetchUrl: "https://example.com/repo.git" },
      { name: "upstream", fetchUrl: "https://example.com/up.git" },
    ]);
  });
});

describe("the error a failed command shows", () => {
  it("is git's own words, not a generic failure", () => {
    expect(gitError({ ok: false, stdout: "", stderr: "fatal: not a valid ref\n", code: 128 })).toBe(
      "fatal: not a valid ref",
    );
    // Falls back to stdout, then to the code, so it is never empty.
    expect(gitError({ ok: false, stdout: "some output", stderr: "", code: 1 })).toBe("some output");
    expect(gitError({ ok: false, stdout: "", stderr: "", code: 2 })).toBe("git exited 2");
  });
});
