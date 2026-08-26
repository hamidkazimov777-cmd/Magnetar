import type * as monaco from "monaco-editor";
import { api } from "./api";
import { clientForPath, pathToUri, supportedLanguages } from "./lspManager";
import { useStore } from "./store";

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

interface LspTextEditR {
  range: LspRange;
  newText: string;
}
interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEditR[]>;
  documentChanges?: Array<{ textDocument: { uri: string }; edits: LspTextEditR[] }>;
}

/** LSP rename result → one map of fs path → text edits, folding away the two
 *  legal shapes (changes / documentChanges). */
function renameGroups(res: LspWorkspaceEdit | null): Map<string, LspTextEditR[]> {
  const groups = new Map<string, LspTextEditR[]>();
  const add = (uri: string, tes: LspTextEditR[]) => groups.set(uriToPath(uri), tes);
  if (res?.documentChanges)
    for (const dc of res.documentChanges) add(dc.textDocument.uri, dc.edits);
  else if (res?.changes) for (const [uri, tes] of Object.entries(res.changes)) add(uri, tes);
  return groups;
}

/** Apply LSP text edits to a string. Edits are applied from the end backwards
 *  so earlier offsets stay valid; positions are UTF-16 code units, which is
 *  exactly how a JS string indexes. */
function applyLspEdits(text: string, edits: LspTextEditR[]): string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const off = (p: { line: number; character: number }) =>
    (lineStarts[p.line] ?? text.length) + p.character;
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = text;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}

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

type LspTextEdit = { range: LspRange; newText: string };
interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number; // 2 = snippet
  textEdit?: LspTextEdit | { insert: LspRange; replace: LspRange; newText: string };
  additionalTextEdits?: LspTextEdit[];
  preselect?: boolean;
}
type CompletionResult =
  | LspCompletionItem[]
  | { isIncomplete: boolean; items: LspCompletionItem[] }
  | null;

/** LSP CompletionItemKind (1–25) → Monaco kind, by name so the enums line up
 *  regardless of their numeric values. */
function completionKindMap(
  m: typeof import("monaco-editor"),
): Record<number, monaco.languages.CompletionItemKind> {
  const K = m.languages.CompletionItemKind;
  return {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field,
    6: K.Variable, 7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property,
    11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword, 15: K.Snippet,
    16: K.Color, 17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
    21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator, 25: K.TypeParameter,
  };
}

/** One LSP completion item → Monaco. Honours an explicit textEdit range when
 *  the server sends one (needed for correct replacement and for insert-vs-replace
 *  edits), falls back to the identifier under the cursor otherwise, and carries
 *  additionalTextEdits through so auto-imports land with the completion. */
function toMonacoCompletion(
  it: LspCompletionItem,
  kinds: Record<number, monaco.languages.CompletionItemKind>,
  fallbackRange: monaco.IRange,
  m: typeof import("monaco-editor"),
): monaco.languages.CompletionItem {
  const te = it.textEdit;
  let range: monaco.languages.CompletionItem["range"] = fallbackRange;
  let insertText = it.insertText ?? it.label;
  if (te) {
    insertText = te.newText;
    range =
      "range" in te
        ? toMonacoRange(te.range)
        : { insert: toMonacoRange(te.insert), replace: toMonacoRange(te.replace) };
  }
  const doc =
    typeof it.documentation === "object" && it.documentation
      ? ({ value: it.documentation.value } as monaco.IMarkdownString)
      : it.documentation;
  return {
    label: it.label,
    kind: kinds[it.kind ?? 1] ?? m.languages.CompletionItemKind.Text,
    insertText,
    insertTextRules:
      it.insertTextFormat === 2
        ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
    detail: it.detail,
    documentation: doc,
    sortText: it.sortText,
    filterText: it.filterText,
    preselect: it.preselect,
    additionalTextEdits: it.additionalTextEdits?.map((e) => ({
      range: toMonacoRange(e.range),
      text: e.newText,
    })),
  };
}

let registered = false;

/** Register LSP-backed editor providers once. Safe to call on every editor
 *  mount; only the first call does anything. */
export function registerLspProviders(m: typeof import("monaco-editor")): void {
  if (registered) return;
  registered = true;

  m.languages.registerHoverProvider(supportedLanguages(), {
    async provideHover(model, position, token) {
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
          { token, timeoutMs: 8000 },
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

  const kinds = completionKindMap(m);
  m.languages.registerCompletionItemProvider(supportedLanguages(), {
    // Rust and friends complete after member/path punctuation as well as while
    // typing an identifier (which Monaco triggers on its own).
    triggerCharacters: [".", ":", "(", "<", '"', "'", "/", "@"],
    async provideCompletionItems(model, position, _context, token) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return { suggestions: [] };
      // The range Monaco replaces: the identifier fragment under the cursor,
      // unless the server hands back an explicit textEdit range per item.
      const word = model.getWordUntilPosition(position);
      const fallbackRange: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      try {
        const res = await client.request<CompletionResult>(
          "textDocument/completion",
          {
            textDocument: { uri: pathToUri(path) },
            position: toLspPosition(position),
          },
          { token, timeoutMs: 8000 },
        );
        const items = !res ? [] : Array.isArray(res) ? res : res.items;
        return {
          suggestions: items.map((it) => toMonacoCompletion(it, kinds, fallbackRange, m)),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  m.languages.registerDefinitionProvider(supportedLanguages(), {
    async provideDefinition(model, position, token) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return null;
      try {
        const res = await client.request<DefinitionResult>(
          "textDocument/definition",
          {
            textDocument: { uri: pathToUri(path) },
            position: toLspPosition(position),
          },
          { token },
        );
        return definitionsToMonaco(res, m);
      } catch {
        return null;
      }
    },
  });

  m.languages.registerReferenceProvider(supportedLanguages(), {
    async provideReferences(model, position, context, token) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return [];
      try {
        const res = await client.request<LspLocation[] | null>(
          "textDocument/references",
          {
            textDocument: { uri: pathToUri(path) },
            position: toLspPosition(position),
            context: { includeDeclaration: context.includeDeclaration },
          },
          { token },
        );
        return definitionsToMonaco(res, m);
      } catch {
        return [];
      }
    },
  });

  m.languages.registerRenameProvider(supportedLanguages(), {
    async provideRenameEdits(model, position, newName) {
      const path = modelPath(model);
      const client = clientForPath(path);
      if (!client) return { edits: [] };
      let res: LspWorkspaceEdit | null;
      try {
        res = await client.request<LspWorkspaceEdit | null>("textDocument/rename", {
          textDocument: { uri: pathToUri(path) },
          position: toLspPosition(position),
          newName,
        });
      } catch (e) {
        return { edits: [], rejectReason: String(e) };
      }
      const groups = renameGroups(res);
      // A file open in the editor is renamed live through Monaco (marking it
      // unsaved, as a rename should); a file that isn't open has no model, so
      // Monaco's bulk edit would silently skip it — apply those on disk here so
      // a project-wide rename actually reaches every file.
      const models = m.editor.getModels();
      const monacoEdits: monaco.languages.IWorkspaceTextEdit[] = [];
      const diskWrites: Array<{ p: string; tes: LspTextEditR[] }> = [];
      for (const [p, tes] of groups) {
        const md = models.find((x) => x.uri.path === p);
        if (md)
          for (const te of tes)
            monacoEdits.push({
              resource: md.uri,
              textEdit: { range: toMonacoRange(te.range), text: te.newText },
              versionId: undefined,
            });
        else diskWrites.push({ p, tes });
      }
      if (diskWrites.length) {
        await Promise.all(
          diskWrites.map(async ({ p, tes }) => {
            try {
              const content = await api.editorReadFile(p);
              await api.toolWriteFile(p, applyLspEdits(content, tes));
            } catch {
              /* a file we cannot read or write is left untouched */
            }
          }),
        );
        useStore.getState().refreshExplorer();
      }
      return { edits: monacoEdits };
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
