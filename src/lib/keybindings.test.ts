import { describe, expect, it } from "vitest";
import {
  DEFAULT_BINDINGS,
  chordOf,
  commandFor,
  describeChord,
  importVsCodeKeybindings,
  normalizeChord,
} from "./keybindings";

describe("describing a keypress", () => {
  it("writes a chord the same way however the modifiers arrived", () => {
    // Two spellings of one chord must compare equal, or conflict detection
    // misses a clash and two bindings quietly do the same thing.
    expect(chordOf({ key: "P", metaKey: true, shiftKey: true })).toBe("mod+shift+p");
    expect(chordOf({ key: "p", ctrlKey: true, shiftKey: true })).toBe("mod+shift+p");
    expect(normalizeChord("shift+cmd+P")).toBe("mod+shift+p");
    expect(normalizeChord("Ctrl+Shift+P")).toBe("mod+shift+p");
  });

  it("treats every platform's modifier name as the same modifier", () => {
    for (const spelling of ["cmd+k", "ctrl+k", "meta+k", "win+k", "mod+k"]) {
      expect(normalizeChord(spelling)).toBe("mod+k");
    }
    expect(normalizeChord("option+f")).toBe("alt+f");
  });
});

describe("what the defaults answer to", () => {
  it("keeps the VS Code binding alongside Magnetar's own", () => {
    // Someone arriving from VS Code has years of muscle memory, and a shortcut
    // that does nothing reads as the app being broken.
    expect(commandFor("mod+shift+p")).toBe("palette.commands");
    expect(commandFor("mod+k")).toBe("palette.commands");
    expect(commandFor("mod+p")).toBe("palette.files");
    expect(commandFor("mod+`")).toBe("view.terminal");
  });

  it("binds go-to-symbol to the chords VS Code uses for it", () => {
    expect(commandFor("mod+t")).toBe("palette.symbols");
    expect(commandFor("mod+shift+o")).toBe("palette.symbols");
  });

  it("answers nothing for a chord nobody bound", () => {
    expect(commandFor("mod+shift+z")).toBeNull();
  });
});

describe("importing a VS Code keybindings.json", () => {
  it("reads the file people actually have, comments and all", () => {
    // VS Code's own file is JSON with comments and a trailing comma; refusing
    // it would make the feature pointless.
    const result = importVsCodeKeybindings(`
      // Place your key bindings in this file
      [
        { "key": "ctrl+shift+e", "command": "workbench.action.toggleSidebarVisibility" },
      ]
    `);
    expect(result.bindings["view.sidebar"]).toContain("mod+shift+e");
    // The default is kept: an import adds a way in, it does not close one.
    expect(result.bindings["view.sidebar"]).toContain("mod+b");
  });

  it("names what it could not honour instead of dropping it", () => {
    const result = importVsCodeKeybindings(
      JSON.stringify([{ key: "ctrl+alt+r", command: "workbench.action.debug.start" }]),
    );
    expect(result.unsupported).toEqual(["workbench.action.debug.start"]);
    // Nothing invented a binding for a thing Magnetar cannot do.
    expect(Object.values(result.bindings).flat()).not.toContain("mod+alt+r");
  });

  it("reports a chord claimed by two commands", () => {
    const result = importVsCodeKeybindings(
      JSON.stringify([
        { key: "ctrl+p", command: "workbench.action.quickOpen" },
        { key: "ctrl+p", command: "workbench.action.showCommands" },
      ]),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toContain("mod+p");
  });

  it("ignores VS Code's removal entries rather than binding them", () => {
    const result = importVsCodeKeybindings(
      JSON.stringify([{ key: "ctrl+p", command: "-workbench.action.quickOpen" }]),
    );
    expect(result.unsupported).toEqual([]);
    expect(result.bindings["palette.files"]).toEqual(DEFAULT_BINDINGS["palette.files"]);
  });

  it("refuses a file that is not one, with a reason", () => {
    expect(() => importVsCodeKeybindings("nope")).toThrow(/not valid JSON/);
    expect(() => importVsCodeKeybindings('{"key":"ctrl+p"}')).toThrow(/expected a list/);
  });

  it("skips malformed entries without abandoning the rest of the file", () => {
    const result = importVsCodeKeybindings(
      JSON.stringify([
        { key: 42, command: "workbench.action.quickOpen" },
        { command: "workbench.action.showCommands" },
        { key: "ctrl+j", command: "workbench.action.terminal.toggleTerminal" },
      ]),
    );
    expect(result.bindings["view.terminal"]).toContain("mod+j");
  });
});

describe("showing a chord to a person", () => {
  it("uses the symbols the platform uses", () => {
    expect(describeChord("mod+shift+p")).toBe("⌘⇧P");
    expect(describeChord("mod+shift+p", false)).toBe("Ctrl+Shift+P");
  });
});
