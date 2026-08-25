import { LspClient } from "./lsp";
import { languageForPath } from "./monaco";
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
}

/** Monaco language id → server. Kept small on purpose (see the header). */
const SERVERS: Record<string, ServerConfig> = {
  rust: { bin: "rust-analyzer", args: [], languageId: "rust" },
  python: { bin: "pyright-langserver", args: ["--stdio"], languageId: "python" },
  go: { bin: "gopls", args: [], languageId: "go" },
};

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

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

/** Absolute path → file URI, percent-encoding each segment but keeping slashes. */
function pathToUri(p: string): string {
  return "file://" + p.split("/").map(encodeURIComponent).join("/");
}

function configFor(path: string): ServerConfig | undefined {
  const lang = languageForPath(path);
  return lang ? SERVERS[lang] : undefined;
}

/** Get (or start) the server for a language, or null if its binary is missing.
 *  Everything is best-effort: a failure here must never disturb the editor. */
async function ensureServer(config: ServerConfig): Promise<Server | null> {
  const cached = servers.get(config.languageId);
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
      servers.set(config.languageId, null);
      return null;
    }

    const client = new LspClient(uid(), found, config.args, root);
    entry = { client, config, ready };
    servers.set(config.languageId, entry);

    // A crashed or stopped server clears its slot so the next open respawns it.
    client.onExit = () => {
      if (servers.get(config.languageId) === entry) {
        servers.delete(config.languageId);
        for (const p of [...open]) if (configFor(p) === config) open.delete(p);
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
    resolveReady();
    return entry;
  } catch {
    // Reservation failed to become a working server: clear it (unless a fresh
    // one already took the slot) so a later open can try again.
    if (servers.get(config.languageId) === entry) servers.delete(config.languageId);
    resolveReady();
    return null;
  }
}

/** A document appeared (buffer loaded). Start its server if needed and open it. */
export async function didOpen(path: string, text: string): Promise<void> {
  const config = configFor(path);
  if (!config || open.has(path)) return;
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
      const server = servers.get(config.languageId);
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
  if (!config) return;
  const server = servers.get(config.languageId);
  server?.client.notify("textDocument/didClose", {
    textDocument: { uri: pathToUri(path) },
  });
}
