import { describe, expect, it } from "vitest";
import { buildSettings, parseSettings } from "./settingsFile";
import { DEFAULT_PREFS } from "./store";
import { DEFAULT_BINDINGS } from "./keybindings";

const state = () => ({
  prefs: { ...DEFAULT_PREFS, autosave: true, agentMaxSteps: 42 },
  keybindings: { ...DEFAULT_BINDINGS, "palette.files": ["mod+e"] },
  theme: "dark",
  lang: "en",
});

describe("what a settings file carries", () => {
  it("carries the shape of the app and nothing dangerous", () => {
    const file = buildSettings(state());
    const text = JSON.stringify(file);
    expect(file.prefs.autosave).toBe(true);
    expect(file.keybindings["palette.files"]).toEqual(["mod+e"]);
    // No keys, no connections, no project memory: this is a file people email
    // to themselves.
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("baseUrl");
  });

  it("leaves out settings that name something on this machine", () => {
    // A connection id means nothing elsewhere; importing it would point the
    // background model at a connection that does not exist there.
    const file = buildSettings({
      ...state(),
      prefs: { ...DEFAULT_PREFS, memoryModel: { connectionId: "c1", model: "m" } },
    });
    expect(file.prefs.memoryModel).toBeUndefined();
  });

  it("round-trips through export and import", () => {
    const back = parseSettings(JSON.stringify(buildSettings(state())));
    expect(back.prefs.autosave).toBe(true);
    expect(back.prefs.agentMaxSteps).toBe(42);
    expect(back.keybindings["palette.files"]).toEqual(["mod+e"]);
    expect(back.theme).toBe("dark");
    expect(back.ignored).toEqual([]);
  });
});

describe("reading a file this version does not fully know", () => {
  it("names what it ignored instead of losing it quietly", () => {
    const back = parseSettings(
      JSON.stringify({
        magnetarSettings: 1,
        prefs: { autosave: true, somethingFromLater: 5 },
        keybindings: { "palette.files": ["mod+e"], "debug.start": ["mod+f5"] },
      }),
    );
    expect(back.prefs.autosave).toBe(true);
    expect(back.ignored).toContain("somethingFromLater");
    expect(back.ignored).toContain("debug.start");
  });

  it("refuses a value of the wrong type rather than storing it", () => {
    // A string where a number belongs sits quietly in the store until
    // something does arithmetic on it.
    const back = parseSettings(
      JSON.stringify({ magnetarSettings: 1, prefs: { agentMaxSteps: "lots" } }),
    );
    expect(back.prefs.agentMaxSteps).toBeUndefined();
    expect(back.ignored).toContain("agentMaxSteps");
  });

  it("refuses a file that is not a settings file, with a reason", () => {
    expect(() => parseSettings("nope")).toThrow(/not valid JSON/);
    expect(() => parseSettings("{}")).toThrow(/not a Magnetar settings file/);
    expect(() => parseSettings('{"magnetarSettings":2}')).toThrow(/not a Magnetar/);
  });

  it("falls back to the defaults when the file binds nothing", () => {
    const back = parseSettings(JSON.stringify({ magnetarSettings: 1, prefs: {} }));
    expect(back.keybindings).toEqual(DEFAULT_BINDINGS);
  });
});
