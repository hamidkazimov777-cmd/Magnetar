import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const ago = (seconds: number) => Math.floor(Date.now() / 1000) - seconds;

describe("relative time", () => {
  it("answers the question a date makes you compute yourself", () => {
    expect(relativeTime(ago(30), "en")).toMatch(/second|now/i);
    expect(relativeTime(ago(300), "en")).toMatch(/minute/i);
    expect(relativeTime(ago(7200), "en")).toMatch(/hour/i);
    expect(relativeTime(ago(3 * 86400), "en")).toMatch(/day/i);
    expect(relativeTime(ago(60 * 86400), "en")).toMatch(/month/i);
    expect(relativeTime(ago(400 * 86400), "en")).toMatch(/year/i);
  });

  it("does not render a future timestamp as a negative age", () => {
    // A clock skew or an unsynced commit time must not read as "in -3 hours".
    const out = relativeTime(Math.floor(Date.now() / 1000) + 3600, "en");
    expect(out).not.toContain("-");
  });

  it("speaks the language it is asked to", () => {
    expect(relativeTime(ago(3 * 86400), "ru")).toMatch(/дн|день/i);
  });
});
