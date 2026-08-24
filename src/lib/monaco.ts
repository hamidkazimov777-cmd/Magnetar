import { loader } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
// monaco-editor 0.56 ships an exports map, so worker paths are package-relative
// ("./*" -> "./esm/vs/*.js") — the old esm/vs/... specifiers no longer resolve.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import cssWorker from "monaco-editor/languages/features/css/css.worker?worker";
import htmlWorker from "monaco-editor/languages/features/html/html.worker?worker";
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";

/* ==========================================================================
   MONACO — the editor engine behind VS Code.

   Everything here is bundled locally: Magnetar must work with no network, so
   we never let @monaco-editor/react fall back to its CDN loader.

   Monaco is the single largest asset in the app (~5 MB), so it is loaded
   lazily: the first time an editor or a marker sync needs it, `loadMonaco()`
   pulls the engine and its language workers off the main bundle, configures
   the themes and TypeScript defaults once, then points @monaco-editor/react
   at our copy via `loader.config`. Every caller shares the one memoized
   promise, so the engine initialises exactly once.
   ========================================================================== */

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

/* --------------------------------------------------------------------------
   EDITOR THEMES

   Both are built straight from the Magnetar palette so the editor reads as
   part of the app rather than an embedded widget: the editor background is the
   app surface, gutters are the app background, and selection is graphite —
   never tinted. Syntax colours are the only place hue is allowed, and they are
   muted to stay comfortable over long sessions.
   -------------------------------------------------------------------------- */
export const MAGNETAR_THEME_DARK = "magnetar-dark";
export const MAGNETAR_THEME_LIGHT = "magnetar-light";

/** Map a resolved UI theme onto the matching editor theme id. */
export function monacoThemeFor(resolved: "light" | "dark") {
  return resolved === "dark" ? MAGNETAR_THEME_DARK : MAGNETAR_THEME_LIGHT;
}

let monacoPromise: Promise<typeof import("monaco-editor")> | null = null;
/** The last theme the app asked for; applied to the editor once it loads. */
let pendingTheme: "light" | "dark" = "light";

/** Load Monaco and its language workers, configure themes and TypeScript
 *  defaults, and hand the engine to @monaco-editor/react. Memoized. */
export function loadMonaco(): Promise<typeof import("monaco-editor")> {
  if (monacoPromise) return monacoPromise;

  monacoPromise = (async () => {
    const m = await import("monaco-editor");

    // Language services run in workers; Vite bundles each one via ?worker.
    window.MonacoEnvironment = {
      getWorker(_workerId: string, label: string) {
        switch (label) {
          case "json":
            return new jsonWorker();
          case "css":
          case "scss":
          case "less":
            return new cssWorker();
          case "html":
          case "handlebars":
          case "razor":
            return new htmlWorker();
          case "typescript":
          case "javascript":
            return new tsWorker();
          default:
            return new editorWorker();
        }
      },
    };

    m.editor.defineTheme(MAGNETAR_THEME_DARK, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280", fontStyle: "italic" },
        { token: "keyword", foreground: "a78bfa" },
        { token: "string", foreground: "34d399" },
        { token: "number", foreground: "fbbf24" },
        { token: "type", foreground: "60a5fa" },
        { token: "function", foreground: "93c5fd" },
        { token: "variable", foreground: "f3f4f6" },
      ],
      colors: {
        "editor.background": "#161a22",
        "editor.foreground": "#f3f4f6",
        "editorLineNumber.foreground": "#4b5563",
        "editorLineNumber.activeForeground": "#9ca3af",
        "editorCursor.foreground": "#f3f4f6",
        "editor.selectionBackground": "#3a415066",
        "editor.inactiveSelectionBackground": "#3a415033",
        "editor.lineHighlightBackground": "#1c2029",
        "editorIndentGuide.background1": "#2a2f3a",
        "editorIndentGuide.activeBackground1": "#3a4150",
        "editorWidget.background": "#1c2029",
        "editorWidget.border": "#2a2f3a",
        "editorSuggestWidget.background": "#1c2029",
        "editorSuggestWidget.border": "#3a4150",
        "editorSuggestWidget.selectedBackground": "#232833",
        "editorHoverWidget.background": "#1c2029",
        "editorHoverWidget.border": "#3a4150",
        "editorGutter.background": "#161a22",
        "editorGutter.modifiedBackground": "#fbbf24",
        "editorGutter.addedBackground": "#34d399",
        "editorGutter.deletedBackground": "#f87171",
        "diffEditor.insertedTextBackground": "#34d3991a",
        "diffEditor.removedTextBackground": "#f871711a",
        "scrollbarSlider.background": "#3a415055",
        "scrollbarSlider.hoverBackground": "#3a415088",
        "scrollbarSlider.activeBackground": "#3a4150bb",
        "minimap.background": "#161a22",
      },
    });

    m.editor.defineTheme(MAGNETAR_THEME_LIGHT, {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "9ca3af", fontStyle: "italic" },
        { token: "keyword", foreground: "6d28d9" },
        { token: "string", foreground: "047857" },
        { token: "number", foreground: "b45309" },
        { token: "type", foreground: "1d4ed8" },
        { token: "function", foreground: "1e40af" },
        { token: "variable", foreground: "111827" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#111827",
        "editorLineNumber.foreground": "#c4c8d0",
        "editorLineNumber.activeForeground": "#6b7280",
        "editorCursor.foreground": "#111827",
        "editor.selectionBackground": "#d3d6dc99",
        "editor.inactiveSelectionBackground": "#e5e7eb88",
        "editor.lineHighlightBackground": "#f4f4f6",
        "editorIndentGuide.background1": "#eaeaee",
        "editorIndentGuide.activeBackground1": "#d3d6dc",
        "editorWidget.background": "#ffffff",
        "editorWidget.border": "#e5e7eb",
        "editorSuggestWidget.background": "#ffffff",
        "editorSuggestWidget.border": "#d3d6dc",
        "editorSuggestWidget.selectedBackground": "#eaeaee",
        "editorHoverWidget.background": "#ffffff",
        "editorHoverWidget.border": "#d3d6dc",
        "editorGutter.background": "#ffffff",
        "editorGutter.modifiedBackground": "#b45309",
        "editorGutter.addedBackground": "#047857",
        "editorGutter.deletedBackground": "#b91c1c",
        "diffEditor.insertedTextBackground": "#04785714",
        "diffEditor.removedTextBackground": "#b91c1c14",
        "scrollbarSlider.background": "#d3d6dc88",
        "scrollbarSlider.hoverBackground": "#c4c8d0",
        "scrollbarSlider.activeBackground": "#9ca3af",
        "minimap.background": "#ffffff",
      },
    });

    // TypeScript/JavaScript IntelliSense without an external language server.
    // Monaco 0.56 moved this out of `languages.typescript` into a top-level
    // export. Semantic errors are noise without the real project graph (every
    // import would be "not found"), so we keep syntax validation and drop
    // semantic validation.
    m.typescript.typescriptDefaults.setCompilerOptions({
      target: m.typescript.ScriptTarget.ESNext,
      module: m.typescript.ModuleKind.ESNext,
      moduleResolution: m.typescript.ModuleResolutionKind.NodeJs,
      jsx: m.typescript.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      allowJs: true,
      esModuleInterop: true,
      strict: false,
    });
    m.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    m.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    // Point @monaco-editor/react at our bundled copy instead of the CDN.
    loader.config({ monaco: m });

    // The app may have asked for a theme before the editor finished loading.
    m.editor.setTheme(monacoThemeFor(pendingTheme));

    return m;
  })();

  return monacoPromise;
}

/** Called by the theme sync in main.tsx whenever the palette flips. Before
 *  Monaco is loaded this only records the choice; it is applied by
 *  `loadMonaco` once the engine arrives. */
export function setMonacoTheme(resolved: "light" | "dark") {
  pendingTheme = resolved;
  if (monacoPromise) {
    void monacoPromise.then((m) => m.editor.setTheme(monacoThemeFor(resolved)));
  }
}

/** Map a file path to a Monaco language id. Monaco ships far more grammars
 *  than we listed with CodeMirror, so this only handles the ambiguous cases —
 *  everything else is resolved from the extension by Monaco itself. */
export function languageForPath(path: string): string | undefined {
  const name = path.split(/[/\\]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";

  const byName: Record<string, string> = {
    dockerfile: "dockerfile",
    makefile: "makefile",
    ".env": "ini",
    ".gitignore": "plaintext",
  };
  if (byName[name.toLowerCase()]) return byName[name.toLowerCase()];

  const byExt: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    rs: "rust",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    sql: "sql",
    md: "markdown",
    markdown: "markdown",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    css: "css",
    scss: "scss",
    less: "less",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    lua: "lua",
    dart: "dart",
    r: "r",
    scala: "scala",
    pl: "perl",
    vue: "html",
    svelte: "html",
  };
  return byExt[ext];
}
