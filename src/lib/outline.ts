/* ==========================================================================
   THE SHAPE OF A FILE, WITHOUT A LANGUAGE SERVER

   Outline and breadcrumbs need to know what is in a file. A language server
   knows exactly — and is not installed, or is still starting, or does not
   exist for the language, more often than not. A structure view that is empty
   until somebody runs `npm install -g` is a structure view nobody sees.

   So this is a heuristic, and it says so. It reads declarations off the start
   of lines and nests them by indentation. It will miss a function assigned
   inside a call, and it will happily list something inside a comment block. In
   exchange it costs nothing, works on the first keystroke, and covers every
   language the app opens rather than the four with a server.

   Where a server IS running its symbols are better and are used instead. This
   is the floor, not the ceiling.

   A real parser (Tree-sitter) would be exact, at the cost of a WASM runtime
   plus a grammar per language — a couple of megabytes for a view that is
   correct nine times in ten without it. That trade is worth revisiting when
   something needs a real tree, which is inline completion (Step 11), not this.
   ========================================================================== */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "constant"
  | "heading"
  | "key";

export interface OutlineSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based, so it can be handed straight to the editor. */
  line: number;
  /** Nesting depth, derived from indentation. */
  level: number;
}

interface Rule {
  re: RegExp;
  kind: SymbolKind;
  /** Which capture group holds the name. */
  group?: number;
}

const TS_RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: "type" },
  // `const foo = (…) =>` and `const foo = function` are how most of a modern
  // codebase declares its functions; treating them as constants would make the
  // outline useless for exactly the files people read most.
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/, kind: "function" },
  { re: /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*[:=]/, kind: "constant" },
  // A class method has no keyword announcing it, and methods are most of what
  // an outline is for. Recognised by shape instead: indented, a call
  // signature, and an opening brace at the end of the line — which is what
  // separates a declaration from a call.
  {
    re: /^\s+(?:(?:public|private|protected|static|async|get|set|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{\s*\}?\s*$/,
    kind: "function",
  },
];

/** Words that look like a method but are control flow. Without this,
 *  `if (ready) {` becomes a symbol called "if". */
const NOT_A_NAME = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "return", "function",
  "class", "try", "finally", "with",
]);

const RUST_RULES: Rule[] = [
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: "class" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "class" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: "interface" },
  { re: /^\s*impl(?:<[^>]*>)?\s+(.+?)\s*\{/, kind: "class" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: "type" },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Z_][A-Z0-9_]*)/, kind: "constant" },
];

const PYTHON_RULES: Rule[] = [
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
];

const GO_RULES: Rule[] = [
  // A method's receiver is what tells you which type it belongs to, so it is
  // kept in the name rather than thrown away.
  { re: /^func\s+\(([^)]*)\)\s*([A-Za-z_]\w*)/, kind: "function", group: 0 },
  { re: /^func\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: "class" },
  { re: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: "interface" },
  { re: /^type\s+([A-Za-z_]\w*)/, kind: "type" },
];

const SHELL_RULES: Rule[] = [
  { re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/, kind: "function" },
];

const RULES_BY_LANGUAGE: Record<string, Rule[]> = {
  ts: TS_RULES,
  tsx: TS_RULES,
  js: TS_RULES,
  jsx: TS_RULES,
  mjs: TS_RULES,
  cjs: TS_RULES,
  rs: RUST_RULES,
  py: PYTHON_RULES,
  go: GO_RULES,
  sh: SHELL_RULES,
  bash: SHELL_RULES,
  zsh: SHELL_RULES,
};

const extensionOf = (path: string): string =>
  path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";

/** Markdown outlines by heading, which is the only structure it has. */
function markdownOutline(text: string): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  let inFence = false;
  text.split("\n").forEach((line, i) => {
    // A `#` inside a fenced block is a shell comment or a CSS id, not a heading.
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ name: m[2], kind: "heading", line: i + 1, level: m[1].length - 1 });
  });
  return out;
}

/** JSON and YAML outline by top-level keys, which is what people navigate by. */
function keyOutline(text: string, json: boolean): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // YAML comment
    const m = json
      ? line.match(/^(\s*)"([^"]+)"\s*:/)
      : line.match(/^(\s*)([A-Za-z_][\w.-]*)\s*:(?:\s|$)/);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "  ").length;
    // Only the first two levels: a deep config listed in full is a second copy
    // of the file, not a way around it.
    if (indent > 2) return;
    out.push({ name: m[2], kind: "key", line: i + 1, level: indent > 0 ? 1 : 0 });
  });
  return out;
}

/** Read the structure of a file well enough to navigate it. */
export function outlineOf(path: string, text: string): OutlineSymbol[] {
  if (!text) return [];
  const ext = extensionOf(path);
  if (ext === "md" || ext === "markdown") return markdownOutline(text);
  if (ext === "json") return keyOutline(text, true);
  if (ext === "yml" || ext === "yaml") return keyOutline(text, false);

  const rules = RULES_BY_LANGUAGE[ext];
  if (!rules) return [];

  const out: OutlineSymbol[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 500) continue; // generated or minified
    for (const rule of rules) {
      const m = line.match(rule.re);
      if (!m) continue;
      const name =
        rule.group === 0
          ? `(${m[1].trim()}) ${m[2]}`.trim()
          : (m[rule.group ?? 1] ?? "").trim();
      if (!name || NOT_A_NAME.has(name)) break;
      const indent = (line.match(/^[\t ]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
      out.push({ name, kind: rule.kind, line: i + 1, level: Math.floor(indent / 2) });
      break; // one symbol per line; the first rule that matches wins
    }
  }
  return out;
}

/** The innermost symbol containing a line, then its ancestors — the trail a
 *  breadcrumb bar shows.
 *
 *  Containment is by "the nearest declaration above me at a shallower level",
 *  which is what indentation means in every language here.
 */
export function trailAt(symbols: OutlineSymbol[], line: number): OutlineSymbol[] {
  const before = symbols.filter((s) => s.line <= line);
  const trail: OutlineSymbol[] = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const candidate = before[i];
    if (trail.length === 0 || candidate.level < trail[0].level) trail.unshift(candidate);
    if (trail.length && trail[0].level === 0) break;
  }
  return trail;
}
