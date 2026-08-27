import { describe, expect, it } from "vitest";
import { MONACO_TOKEN_TYPES, remapTokenTypes } from "./lspEditor";

/** One token: deltaLine, deltaStart, length, type, modifiers. */
const token = (type: number) => [0, 0, 4, type, 0];

describe("translating a server's semantic tokens", () => {
  it("maps the server's numbering onto this editor's", () => {
    // Every server picks its own legend order, so the same integer means
    // different things in rust-analyzer and Pyright.
    const serverTypes = ["variable", "function"];
    const out = remapTokenTypes([...token(0), ...token(1)], serverTypes);
    expect(out[3]).toBe(MONACO_TOKEN_TYPES.indexOf("variable"));
    expect(out[8]).toBe(MONACO_TOKEN_TYPES.indexOf("function"));
  });

  it("drops a token type this editor does not render", () => {
    // A variable painted as a type is worse than a variable painted as
    // nothing, so the span is given zero length and Monaco skips it.
    const out = remapTokenTypes(token(0), ["somethingExotic"]);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
  });

  it("leaves position and length alone for a type it knows", () => {
    const out = remapTokenTypes([3, 7, 12, 0, 5], ["class"]);
    expect(out[0]).toBe(3);
    expect(out[1]).toBe(7);
    expect(out[2]).toBe(12);
    expect(out[4]).toBe(5);
  });

  it("handles an empty stream and a malformed tail without throwing", () => {
    expect(remapTokenTypes([], ["variable"])).toEqual([]);
    // Four integers is not a token; rewriting half of one would corrupt the
    // stream rather than salvage it.
    expect(remapTokenTypes([0, 0, 4, 0], ["variable"])).toEqual([0, 0, 4, 0]);
  });

  it("drops everything when the server's legend is empty", () => {
    const out = remapTokenTypes(token(0), []);
    expect(out[2]).toBe(0);
  });
});
