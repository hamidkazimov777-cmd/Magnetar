import { LspClient } from "./lsp";
import { languageForPath, loadMonaco } from "./monaco";
import { useStore } from "./store";

/* ==========================================================================
   LSP MANAGER

   Keeps language servers in sync with the open editor documents: one server per
   language, spawned on demand from a binary already on the user's PATH, wired
   through the initialize handshake, then fed didOpen/didChange/didClose as tabs
   come and go. Editor features (definition, hover, diagnostics) build on the
   clients this hands out — that is 3.2/3.3.

   Deliberately narrow for now: only languages Monaco's own workers do NOT
   already handle. TypeScript/JavaScript/JSON/CSS/HTML stay on Monaco until 3.4
   replaces the single TS worker, so we never run two language services over the
   same file.
   ========================================================================== */

interface ServerConfig {
  /** Executable to look for on PATH. */
  bin: string;
  /** Arguments to launch it in stdio mode. */
  args: string[];
  /** The id LSP expects in didOpen (usually the Monaco id, occasionally not). */
  languageId: string;
  /** Server-pool key: languages sharing a key share ONE process (TS + JS both
   *  run on typescript-language-server). Defaults to `languageId`. */
  key?: string;
  /** Human name and install command, shown when the binary isn't on PATH. */
  label: string;
  install: string;
}

/** Monaco language id → server. TypeScript/JavaScript share one process
 *  (`key: "typescript"`); when its server actually starts we hand TS/JS over to
 *  it and switch Monaco's built-in worker off, so the two never double up. */
const SERVERS: Record<string, ServerConfig> = {
  rust: {
    bin: "rust-analyzer",
    args: [],
    languageId: "rust",
    label: "Rust (rust-analyzer)",
    install: "rustup component add rust-analyzer",
  },
  python: {
    bin: "pyright-langserver",
    args: ["--stdio"],
    languageId: "python",
    label: "Python (Pyright)",
    install: "npm install -g pyright",
  },
  go: {
    bin: "gopls",
    args: [],
    languageId: "go",
    label: "Go (gopls)",
    install: "go install golang.org/x/tools/gopls@latest",
  },
  typescript: {
    bin: "typescript-language-server",
    args: ["--stdio"],
    languageId: "typescript",
    key: "typescript",
    label: "TypeScript (typescript-language-server)",
    install: "npm install -g typescript-language-server typescript",
  },
  javascript: {
    bin: "typescript-language-server",
    args: ["--stdio"],
    languageId: "javascript",
    key: "typescript",
    label: "TypeScript (typescript-language-server)",
    install: "npm install -g typescript-language-server typescript",
  },
};

/** The server-pool key for a config (shared process key, else its languageId). */
const serverKey = (c: ServerConfig): string => c.key ?? c.languageId;

interface Server {
  client: LspClient;
  config: ServerConfig;
  /** Resolves once the initialize handshake has completed. */
  ready: Promise<void>;
}

/** One entry per language. `null` means "checked, binary not installed" — cached
 *  so we do not shell out to `which` on every keystroke. */
const servers = new Map<string, Server | null>();
/** Document versions, so didChange always carries a monotonic number. */
const versions = new Map<string, number>();
/** Paths we have sent didOpen for, to pair open/close correctly. */
const open = new Set<string>();
/** Debounce timers per path, so a burst of keystrokes is one didChange. */
const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** How many times a language's server has been auto-restarted since it last
 *  came up cleanly — a loop guard so a server that crashes on start does not
 *  respawn forever. Reset on a successful initialize. */
const restartCounts = new Map<string, number>();
const MAX_RESTARTS = 3;

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** Absolute path → file URI, percent-encoding each segment but keeping slashes. */
export function pathToUri(p: string): string {
  return "file://" + p.split("/").map(encodeURIComponent).join("/");
}

/** file URI → absolute path (inverse of pathToUri). */
function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

/** Marker owner for language-server diagnostics — kept separate from the
 *  project-check markers so the two never overwrite each other. */
const DIAG_OWNER = "lsp";

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number; // 1 error, 2 warning, 3 info, 4 hint
  message: string;
  source?: string;
  code?: string | number | { value: string | number };
}

/** publishDiagnostics → Monaco markers (the squiggles under the code). Only
 *  files currently open in the editor have a model to mark; diagnostics for
 *  others are ignored until they are opened. */
async function applyDiagnostics(uri: string, diagnostics: LspDiagnostic[]): Promise<void> {
  const m = await loadMonaco();
  const path = uriToPath(uri);
  const model = m.editor.getModels().find((md) => md.uri.path === path);
  if (!model) return;
  const sev = (s: number) =>
    s === 1
      ? m.MarkerSeverity.Error
      : s === 2
        ? m.MarkerSeverity.Warning
        : s === 3
          ? m.MarkerSeverity.Info
          : m.MarkerSeverity.Hint;
  m.editor.setModelMarkers(
    model,
    DIAG_OWNER,
    diagnostics.map((d) => ({
      severity: sev(d.severity ?? 1),
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      source: d.source,
      code:
        typeof d.code === "object" && d.code ? String(d.code.value) : d.code?.toString(),
    })),
  );
  // Mirror into the store so the Problems panel and status bar can show them.
  const sevName = (s: number): "error" | "warning" | "info" =>
    s === 1 ? "error" : s === 2 ? "warning" : "info";
  useStore.getState().setLspDiagnostics(
    path,
    diagnostics.map((d) => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      severity: sevName(d.severity ?? 1),
      message: d.message,
      source: d.source,
      code: typeof d.code === "object" && d.code ? String(d.code.value) : d.code?.toString(),
    })),
  );
}

/** Drop any language-server markers for a path (on close). */
async function clearDiagnostics(path: string): Promise<void> {
  useStore.getState().setLspDiagnostics(path, []);
  const m = await loadMonaco();
  const model = m.editor.getModels().find((md) => md.uri.path === path);
  if (model) m.editor.setModelMarkers(model, DIAG_OWNER, []);
}

function configFor(path: string): ServerConfig | undefined {
  const lang = languageForPath(path);
  return lang ? SERVERS[lang] : undefined;
}

/** The ready client serving a path's language, or null if there is none.
 *  Editor features (hover, definition) ask through this. */
export function clientForPath(path: string): LspClient | null {
  const config = configFor(path);
  if (!config) return null;
  const server = servers.get(serverKey(config));
  return server ? server.client : null;
}

/** The server-pool key for a path's language (for looking up its install hint),
 *  or undefined if no server is configured for that language. */
export function serverKeyForPath(path: string): string | undefined {
  const config = configFor(path);
  return config ? serverKey(config) : undefined;
}

/** The Monaco languages that have a server configured, for provider
 *  registration. */
export function supportedLanguages(): string[] {
  return Object.keys(SERVERS);
}

/** Turn Monaco's built-in TS/JS language features off, so the language server
 *  is the single source of hovers/completion/diagnostics. Syntax highlighting
 *  (a separate tokenizer) is untouched. Best-effort — never throws upward. */
async function disableMonacoTs(): Promise<void> {
  try {
    const m = await loadMonaco();
    const off = {
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      diagnostics: false,
      documentRangeFormattingEdits: false,
      signatureHelp: false,
      onTypeFormattingEdits: false,
      codeActions: false,
      inlayHints: false,
    };
    m.typescript.typescriptDefaults.setModeConfiguration(off);
    m.typescript.javascriptDefaults.setModeConfiguration(off);
  } catch {
    /* Monaco not ready or API shape changed — leave its worker on */
  }
}

/** Get (or start) the server for a language, or null if its binary is missing.
 *  Everything is best-effort: a failure here must never disturb the editor. */
async function ensureServer(config: ServerConfig): Promise<Server | null> {
  const cached = servers.get(serverKey(config));
  if (cached !== undefined) return cached;

  const root = useStore.getState().workspaceRoot;
  if (!root) return null;

  // Reserve the slot before the async work so two documents opening at once do
  // not each spawn a server.
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let entry: Server | null = null;

  try {
    // In the browser preview there is no Tauri backend; this throws and we
    // cache "unavailable" so we never retry per keystroke.
    const found = await import("./api").then((m) => m.api.lspWhich(config.bin));
    if (!found) {
      servers.set(serverKey(config), null);
      // Tell the editor which server is missing and how to install it, so the
      // user sees an actionable hint instead of silently getting no analysis.
      useStore.getState().setLspMissing(serverKey(config), {
        label: config.label,
        install: config.install,
      });
      return null;
    }

    const client = new LspClient(uid(), found, config.args, root);
    entry = { client, config, ready };
    servers.set(serverKey(config), entry);

    // Live diagnostics: the server pushes these as it reparses, we turn them
    // into editor squiggles.
    client.onNotification("textDocument/publishDiagnostics", (params) => {
      const p = params as { uri: string; diagnostics?: LspDiagnostic[] };
      void applyDiagnostics(p.uri, p.diagnostics ?? []);
    });

    // A crashed or stopped server clears its slot; if documents are still open,
    // restart it (with backoff and a loop cap) and reopen them so features
    // recover without the user reopening files.
    client.onExit = () => {
      if (servers.get(serverKey(config)) !== entry) return;
      servers.delete(serverKey(config));
      // Reopen every doc this server was serving — for a shared process (TS+JS)
      // that spans more than one language, so match by pool key, not identity.
      const affected = [...open].filter((p) => {
        const c = configFor(p);
        return c && serverKey(c) === serverKey(config);
      });
      for (const p of affected) {
        open.delete(p);
        versions.delete(p);
      }
      const count = (restartCounts.get(serverKey(config)) ?? 0) + 1;
      if (affected.length && count <= MAX_RESTARTS) {
        restartCounts.set(serverKey(config), count);
        setTimeout(() => void restart(affected), 1000 * count);
      }
    };

    await client.start();
    await client.request("initialize", {
      processId: null,
      rootUri: pathToUri(root),
      workspaceFolders: [{ uri: pathToUri(root), name: root.split("/").pop() }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { workspaceFolders: true },
      },
    });
    client.notify("initialized", {});
    // A clean start clears the restart loop guard and the "missing" hint.
    restartCounts.delete(serverKey(config));
    useStore.getState().setLspMissing(serverKey(config), null);
    // TypeScript is the one language Monaco already services with its own
    // worker. Now that a real project-wide server is up, switch Monaco's TS/JS
    // language features off so hovers, completion and diagnostics come from the
    // server alone — never both at once. Syntax highlighting is unaffected.
    if (serverKey(config) === "typescript") await disableMonacoTs();
    resolveReady();
    return entry;
  } catch {
    // Reservation failed to become a working server: clear it (unless a fresh
    // one already took the slot) so a later open can try again.
    if (servers.get(serverKey(config)) === entry) servers.delete(serverKey(config));
    resolveReady();
    return null;
  }
}

/** A document appeared (buffer loaded). Start its server if needed and open it. */
export async function didOpen(path: string, text: string): Promise<void> {
  const config = configFor(path);
  if (!config || open.has(path)) return;
  // Wipe any stale squiggles from a previous session of this file (e.g. it was
  // closed unsaved with an error); the server republishes fresh ones for the
  // text we send below.
  void clearDiagnostics(path);
  const server = await ensureServer(config);
  if (!server) return;
  await server.ready;
  versions.set(path, 1);
  open.add(path);
  server.client.notify("textDocument/didOpen", {
    textDocument: {
      uri: pathToUri(path),
      languageId: config.languageId,
      version: 1,
      text,
    },
  });
}

/** The document changed. Debounced full-text sync — correct and simple; the
 *  server re-derives what it needs. */
export function didChange(path: string, text: string): void {
  if (!open.has(path)) return;
  const config = configFor(path);
  if (!config) return;
  const existing = changeTimers.get(path);
  if (existing) clearTimeout(existing);
  changeTimers.set(
    path,
    setTimeout(() => {
      changeTimers.delete(path);
      const server = servers.get(serverKey(config));
      if (!server || !open.has(path)) return;
      const version = (versions.get(path) ?? 1) + 1;
      versions.set(path, version);
      server.client.notify("textDocument/didChange", {
        textDocument: { uri: pathToUri(path), version },
        contentChanges: [{ text }],
      });
    }, 250),
  );
}

/** Reopen documents after a server restart, reading their current content from
 *  disk (the freshest we have without the editor's buffer). didOpen respawns
 *  the server since the slot was cleared on exit. */
async function restart(paths: string[]): Promise<void> {
  const { api } = await import("./api");
  for (const p of paths) {
    try {
      const text = await api.editorReadFile(p);
      await didOpen(p, text);
    } catch {
      /* a file we cannot read is skipped */
    }
  }
}

/** The document closed. */
export function didClose(path: string): void {
  if (!open.has(path)) return;
  const config = configFor(path);
  open.delete(path);
  versions.delete(path);
  const timer = changeTimers.get(path);
  if (timer) {
    clearTimeout(timer);
    changeTimers.delete(path);
  }
  void clearDiagnostics(path);
  if (!config) return;
  const server = servers.get(serverKey(config));
  server?.client.notify("textDocument/didClose", {
    textDocument: { uri: pathToUri(path) },
  });
}
