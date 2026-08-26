import { describe, expect, it } from "vitest";
import { buildRegExp, countMatches } from "./replace";

describe("what gets counted is what gets replaced", () => {
  it("treats a literal query literally", () => {
    // Someone searching for `a.b` is not asking about any character between
    // a and b, however much a regex engine would like to think so.
    const re = buildRegExp("a.b", {});
    expect(countMatches("a.b axb aXb", re)).toBe(1);
  });

  it("treats a regex query as a regex", () => {
    const re = buildRegExp(String.raw`fn \w+`, { regex: true });
    expect(countMatches("fn one\nfn two\nnope", re)).toBe(2);
  });

  it("honours case sensitivity and whole words", () => {
    expect(countMatches("Widget widget", buildRegExp("widget", {}))).toBe(2);
    expect(
      countMatches("Widget widget", buildRegExp("widget", { caseSensitive: true })),
    ).toBe(1);
    expect(countMatches("cat concatenate", buildRegExp("cat", { wholeWord: true }))).toBe(1);
  });

  it("does not hang on a pattern that matches nothing at all", () => {
    // `x*` matches the empty string at every position. The naive exec loop
    // never advances past it and takes the app with it.
    const re = buildRegExp("x*", { regex: true });
    const count = countMatches("abc", re);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it("counts overlapping-looking matches the way the replace will apply them", () => {
    // Whatever the count says, the replace has to change exactly that many.
    const re = buildRegExp("aa", {});
    const text = "aaaa";
    expect(countMatches(text, re)).toBe(2);
    expect(text.replace(new RegExp(re.source, re.flags), "b")).toBe("bb");
  });

  it("finds nothing in an empty haystack", () => {
    expect(countMatches("", buildRegExp("needle", {}))).toBe(0);
  });
});
