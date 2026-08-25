import type * as monaco from "monaco-editor";
import { clientForPath, pathToUri, supportedLanguages } from "./lspManager";

/* ==========================================================================
   LSP EDITOR FEATURES

   Bridges Monaco's provider APIs to the language servers behind lspManager.
   Each provider turns a Monaco request into an LSP request, waits for the
   server, and converts the reply back. Registered once, for every language
   that has a server configured.

   Coordinate systems differ and this is the usual source of off-by-one bugs:
   LSP positions are 0-based (line, character); Monaco is 1-based (lineNumber,
   column). Conversions live in one place below.
   ========================================================================== */

/** Monaco (1-based) position → LSP (0-based). */
function toLspPosition(position: monaco.Position): { line: number; character: number } {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

/** The filesystem path a model stands for. Models are created from the tab's
 *  absolute path, so the uri path is that path. */
function modelPath(model: monaco.editor.ITextModel): string {
  return model.uri.path;
}

/** LSP file URI → filesystem path (the inverse of pathToUri). */
function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** LSP range (0-based) → Monaco range (1-based). */
function toMonacoRange(r: LspRange): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

type MarkedString = string | { language?: string; value: string };
interface MarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}
interface HoverResult {
  contents: MarkupContent | MarkedString | MarkedString[];
  range?: LspRange;
}

interface LspLocation {
  uri: string;
  range: LspRange;
}
interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
}
type DefinitionResult = LspLocation | LspLocationLink | Array<LspLocation | LspLocationLink> | null;

/** LSP definition result (several legal shapes) → Monaco locations. The target
 *  uri is rebuilt with Uri.parse(path) so it matches how the editor's own tab
 *  models are keyed — same file resolves to the same uri, cross-file differs. */
function definitionsToMonaco(
  res: DefinitionResult,
  m: typeof import("monaco-editor"),
): monaco.languages.Location[] {
  if (!res) return [];
  const list = Array.isArray(res) ? res : [res];
  return list.map((loc) => {
    if ("targetUri" in loc) {
      return {
        uri: m.Uri.parse(uriToPath(loc.targetUri)),
        range: toMonacoRange(loc.targetSelectionRange ?? loc.targetRange),
      };
    }
    return { uri: m.Uri.parse(uriToPath(loc.uri)), range: toMonacoRange(loc.range) };
  });
}

/** Flatten LSP hover contents (several shapes are legal) into Monaco's list of
 *  markdown strings. A `{ language, value }` marked string becomes a fenced
 *  code block so it renders as code. */
function hoverMarkdown(contents: HoverResult["contents"]): monaco.IMarkdownString[] {
  const one = (c: MarkedString): string =>
    typeof c === "string"
      ? c
      : c.language
        ? "```" + c.language + "\n" + c.value + "\n```"
        : c.value;

  if (typeof contents === "string") return [{ value: contents }];
  if (Array.isArray(contents)) return contents.map((c) => ({ value: one(c) }));
  // MarkupContent and single MarkedString both have `value`; MarkupContent's
  // value is already markdown or plain text, so pass it through.
  if ("kind" in contents) return [{ value: contents.value }];
  return [{ value: one(contents) }];
}

let registered = false;

/** Register LSP-backed editor providers once. Safe to call on every editor
 *  mount; only the first call does anything. */
export function registerLspProviders(m: typeof import("monaco-editor")): void {
  if (registered) return;
  registered = true;

  m.languages.registerHoverProvider(supportedLanguages(), {
    async provideHover(model, position) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return null;
      try {
        const result = await client.request<HoverResult | null>(
          "textDocument/hover",
          {
            textDocument: { uri: pathToUri(path) },
            position: toLspPosition(position),
          },
        );
        if (!result || !result.contents) return null;
        return {
          contents: hoverMarkdown(result.contents),
          range: result.range ? toMonacoRange(result.range) : undefined,
        };
      } catch {
        return null; // a stale or failed request must not break hovering
      }
    },
  });

  m.languages.registerDefinitionProvider(supportedLanguages(), {
    async provideDefinition(model, position) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return null;
      try {
        const res = await client.request<DefinitionResult>("textDocument/definition", {
          textDocument: { uri: pathToUri(path) },
          position: toLspPosition(position),
        });
        return definitionsToMonaco(res, m);
      } catch {
        return null;
      }
    },
  });
}

/** Route "go to definition" through our own tab system. A standalone Monaco
 *  editor cannot open a *different* file on its own — its editor service does
 *  nothing for a foreign uri, so ⌘-clicking a symbol defined elsewhere would
 *  just sit there. We patch the one shared code-editor service to open the tab
 *  and reveal the line instead. In-file jumps (same path) go through the same
 *  path — openTab is idempotent — so behaviour is uniform. */
export function installDefinitionOpener(
  editor: monaco.editor.IStandaloneCodeEditor,
  handlers: {
    openTab: (tab: { path: string; name: string; kind: "file" }) => void;
    revealInFile: (path: string, line: number, column?: number) => void;
  },
): void {
  const svc = (editor as unknown as { _codeEditorService?: Record<string, unknown> })
    ._codeEditorService;
  if (!svc || svc.__magnetarPatched) return;
  svc.__magnetarPatched = true;
  svc.openCodeEditor = async (
    input: {
      resource: monaco.Uri;
      options?: { selection?: monaco.IRange };
    },
    source: monaco.editor.ICodeEditor | null,
  ) => {
    const path = input.resource.path;
    const name = path.split("/").pop() || path;
    handlers.openTab({ path, name, kind: "file" });
    const sel = input.options?.selection;
    if (sel) handlers.revealInFile(path, sel.startLineNumber, sel.startColumn);
    return source ?? editor;
  };
}
