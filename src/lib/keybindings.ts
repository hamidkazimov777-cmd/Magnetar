/* ==========================================================================
   KEYBOARD SHORTCUTS

   Two things this has to get right.

   First, muscle memory. Someone arriving from VS Code has years of it, and the
   cost of a shortcut that does nothing is not the missing feature — it is the
   half-second of doubt about whether the app is working. So the defaults carry
   the VS Code binding alongside Magnetar's own wherever they differ, and both
   work.

   Second, a shortcut belongs to the person using it. `keybindings.json` from
   VS Code can be imported, and what could not be honoured is reported rather
   than dropped silently: an import that claims success and quietly ignores
   half the file is worse than one that refuses.
   ========================================================================== */

/** Every action a key can be bound to. */
export type Command =
  | "palette.commands"
  | "palette.files"
  | "view.terminal"
  | "view.sidebar"
  | "view.agentPanel"
  | "editor.save"
  | "editor.closeTab"
  | "search.focus";

/** `mod` is ⌘ on macOS and Ctrl elsewhere, the way VS Code writes it. */
export type Chord = string;

/** What each command answers to out of the box.
 *
 *  Where Magnetar and VS Code disagree, both are listed. The command palette is
 *  the case that matters: VS Code uses ⌘⇧P, Magnetar has always used ⌘K, and
 *  taking either away to satisfy a table would be choosing tidiness over the
 *  person pressing the key.
 */
export const DEFAULT_BINDINGS: Record<Command, Chord[]> = {
  "palette.commands": ["mod+k", "mod+shift+p"],
  "palette.files": ["mod+p"],
  "view.terminal": ["mod+j", "mod+`"],
  "view.sidebar": ["mod+b"],
  "view.agentPanel": ["mod+shift+a"],
  "editor.save": ["mod+s"],
  "editor.closeTab": ["mod+w"],
  "search.focus": ["mod+shift+f"],
};

/** Describe a key event the same way a binding is written.
 *
 *  Order is fixed (mod, shift, alt, key) so two spellings of one chord compare
 *  equal — otherwise "shift+mod+p" and "mod+shift+p" would be different
 *  bindings that do the same thing, and conflict detection would miss it.
 */
export function chordOf(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): Chord {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

/** Normalise a chord as written by a person or by VS Code. */
export function normalizeChord(raw: string): Chord {
  const parts = raw
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const has = (...names: string[]) => parts.some((p) => names.includes(p));
  const key = parts[parts.length - 1] ?? "";
  const out: string[] = [];
  // cmd, ctrl and win all mean "the modifier this platform uses".
  if (has("mod", "cmd", "meta", "ctrl", "control", "win")) out.push("mod");
  if (has("shift")) out.push("shift");
  if (has("alt", "option")) out.push("alt");
  out.push(key);
  return out.join("+");
}

/** Which command a chord should run, given the current bindings. */
export function commandFor(
  chord: Chord,
  bindings: Record<string, Chord[]> = DEFAULT_BINDINGS,
): Command | null {
  for (const [command, chords] of Object.entries(bindings)) {
    if (chords.includes(chord)) return command as Command;
  }
  return null;
}

/** VS Code command ids we can honour, mapped to ours.
 *
 *  Deliberately short. Claiming to import a binding for something Magnetar
 *  cannot do would produce a shortcut that silently does nothing, which is
 *  exactly the doubt this is meant to prevent.
 */
const VSCODE_COMMANDS: Record<string, Command> = {
  "workbench.action.showCommands": "palette.commands",
  "workbench.action.quickOpen": "palette.files",
  "workbench.action.terminal.toggleTerminal": "view.terminal",
  "workbench.action.toggleSidebarVisibility": "view.sidebar",
  "workbench.action.files.save": "editor.save",
  "workbench.action.closeActiveEditor": "editor.closeTab",
  "workbench.action.findInFiles": "search.focus",
};

export interface ImportResult {
  bindings: Record<Command, Chord[]>;
  /** Commands Magnetar has no equivalent for, named so the user knows what
   *  did not come across instead of wondering later. */
  unsupported: string[];
  /** Chords that would run two different things. The later one wins, and the
   *  clash is reported — a silent winner is a shortcut that mysteriously does
   *  the wrong thing. */
  conflicts: string[];
}

/** Read a VS Code `keybindings.json`.
 *
 *  It permits comments and trailing commas, which `JSON.parse` does not, so
 *  those are stripped first: refusing the file people actually have would make
 *  the feature pointless.
 */
export function importVsCodeKeybindings(text: string): ImportResult {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error("not a keybindings.json: the file is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("not a keybindings.json: expected a list");

  const bindings: Record<Command, Chord[]> = Object.fromEntries(
    Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, [...v]]),
  ) as Record<Command, Chord[]>;
  const unsupported: string[] = [];
  const conflicts: string[] = [];
  const claimed = new Map<Chord, Command>();

  for (const raw of parsed) {
    const entry = raw as { key?: unknown; command?: unknown };
    if (typeof entry.key !== "string" || typeof entry.command !== "string") continue;
    // A leading minus is VS Code's way of removing a binding, not adding one.
    if (entry.command.startsWith("-")) continue;

    const command = VSCODE_COMMANDS[entry.command];
    if (!command) {
      if (!unsupported.includes(entry.command)) unsupported.push(entry.command);
      continue;
    }
    const chord = normalizeChord(entry.key);
    const already = claimed.get(chord);
    if (already && already !== command) conflicts.push(`${chord}: ${already} / ${command}`);
    claimed.set(chord, command);
    if (!bindings[command].includes(chord)) bindings[command].unshift(chord);
  }

  return { bindings, unsupported, conflicts };
}

/** How a chord is written for a person to read. */
export function describeChord(chord: Chord, mac = true): string {
  return chord
    .split("+")
    .map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      if (part === "shift") return mac ? "⇧" : "Shift";
      if (part === "alt") return mac ? "⌥" : "Alt";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(mac ? "" : "+");
}
