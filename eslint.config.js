import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

/* Flat config for the Vite + React + TypeScript frontend. The Rust side has its
   own tooling (cargo fmt / clippy); this covers src/ only. `prettier` is last so
   formatting rules never fight the formatter. */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", "*.config.js", "*.config.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // The classic Rules of Hooks stay as errors. The dependency check is a
      // warning — it has real false positives on intentional one-shot effects.
      // The rest of eslint-plugin-react-hooks v7's new rules (set-state-in-
      // effect, purity, immutability, refs, manual-memoization) are opinionated
      // lints on legitimate patterns, not bugs, so they are not enabled here.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Underscore-prefixed args/vars are an intentional "unused on purpose"
      // marker; keep the rest as errors.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
