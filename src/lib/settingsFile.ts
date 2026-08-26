import { api } from "./api";
import { DEFAULT_PREFS, type Prefs } from "./store";
import { DEFAULT_BINDINGS } from "./keybindings";

/* ==========================================================================
   SETTINGS AS A FILE

   Somebody who has set the app up the way they like should be able to carry
   that to another machine, and should be able to get it back after a reset.
   Neither is possible while the only copy lives in the browser storage of one
   installation.

   Deliberately not a backup of everything: no keys, no connections, no
   project memory. Those are either secrets or a different export. This is the
   shape of the app, and nothing that would be dangerous in an email.
   ========================================================================== */

export interface SettingsFile {
  magnetarSettings: 1;
  exportedAt: string;
  prefs: Partial<Prefs>;
  keybindings: Record<string, string[]>;
  theme?: string;
  lang?: string;
}

export function buildSettings(state: {
  prefs: Prefs;
  keybindings: Record<string, string[]>;
  theme: string;
  lang: string;
}): SettingsFile {
  // memoryModel names a connection by id, which means nothing on another
  // machine — carrying it over would point the background model at a
  // connection that does not exist there.
  const { memoryModel: _drop, subagentRoster: _roster, ...portable } = state.prefs;
  return {
    magnetarSettings: 1,
    exportedAt: new Date().toISOString(),
    prefs: portable,
    keybindings: state.keybindings,
    theme: state.theme,
    lang: state.lang,
  };
}

export interface SettingsImport {
  prefs: Partial<Prefs>;
  keybindings: Record<string, string[]>;
  theme?: string;
  lang?: string;
  /** Keys in the file that this version has no setting for. Named rather than
   *  dropped, so an older or newer export does not silently lose half of
   *  itself. */
  ignored: string[];
}

/** Read a settings file, keeping only what this version understands. */
export function parseSettings(json: string): SettingsImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("not a Magnetar settings file: the file is not valid JSON");
  }
  const file = parsed as Partial<SettingsFile>;
  if (!file || typeof file !== "object" || file.magnetarSettings !== 1)
    throw new Error("not a Magnetar settings file");

  const ignored: string[] = [];
  const prefs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file.prefs ?? {})) {
    const known = key in DEFAULT_PREFS;
    // Type has to match as well as the name: a string where a number belongs
    // would sit in the store until something divided by it.
    const sameShape =
      known && typeof value === typeof DEFAULT_PREFS[key as keyof Prefs];
    if (sameShape) prefs[key] = value;
    else ignored.push(key);
  }

  const keybindings: Record<string, string[]> = {};
  for (const [command, chords] of Object.entries(file.keybindings ?? {})) {
    if (!(command in DEFAULT_BINDINGS)) {
      ignored.push(command);
      continue;
    }
    if (Array.isArray(chords) && chords.every((c) => typeof c === "string"))
      keybindings[command] = chords;
    else ignored.push(command);
  }

  return {
    prefs: prefs as Partial<Prefs>,
    keybindings: Object.keys(keybindings).length ? keybindings : DEFAULT_BINDINGS,
    theme: typeof file.theme === "string" ? file.theme : undefined,
    lang: typeof file.lang === "string" ? file.lang : undefined,
    ignored,
  };
}

/** Ask where to put it, then write it. Returns the path, or null if cancelled. */
export async function exportSettings(state: {
  prefs: Prefs;
  keybindings: Record<string, string[]>;
  theme: string;
  lang: string;
}): Promise<string | null> {
  const path = await api.pickSavePath("magnetar-settings.json", ["json"]);
  if (!path) return null;
  await api.toolWriteFile(path, JSON.stringify(buildSettings(state), null, 2));
  return path;
}
