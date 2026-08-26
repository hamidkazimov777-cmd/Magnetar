import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Eraser, RotateCcw, ChevronDown, TerminalSquare } from "../icons";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { useResolvedTheme } from "../../lib/useTheme";

/** xterm cannot read CSS variables, so the two palettes are spelled out here.
 *  They track the design tokens: the terminal sits on the app surface, and ANSI
 *  colours are the muted set used everywhere else. */
const TERM_THEMES = {
  light: {
    background: "#ffffff",
    foreground: "#111827",
    cursor: "#111827",
    selectionBackground: "#d3d6dc99",
    black: "#111827",
    brightBlack: "#6b7280",
    blue: "#1d4ed8",
    brightBlue: "#2563eb",
    green: "#047857",
    brightGreen: "#059669",
    yellow: "#b45309",
    brightYellow: "#d97706",
    red: "#b91c1c",
    brightRed: "#dc2626",
    magenta: "#a21caf",
    brightMagenta: "#c026d3",
    cyan: "#0e7490",
    brightCyan: "#0891b2",
    white: "#6b7280",
    brightWhite: "#111827",
  },
  dark: {
    background: "#161a22",
    foreground: "#f3f4f6",
    cursor: "#f3f4f6",
    selectionBackground: "#3a415088",
    black: "#0f1115",
    brightBlack: "#6b7280",
    blue: "#60a5fa",
    brightBlue: "#93c5fd",
    green: "#34d399",
    brightGreen: "#6ee7b7",
    yellow: "#fbbf24",
    brightYellow: "#fcd34d",
    red: "#f87171",
    brightRed: "#fca5a5",
    magenta: "#e879f9",
    brightMagenta: "#f0abfc",
    cyan: "#22d3ee",
    brightCyan: "#67e8f9",
    white: "#d1d5db",
    brightWhite: "#f9fafb",
  },
} as const;

/** Bottom dock terminal — a real PTY in the project root. Toggle with ⌘J. */
export function TerminalPanel() {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const resolvedTheme = useResolvedTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [generation, setGeneration] = useState(0);

  // Held in a ref so the spawn effect can read the current theme without
  // listing it as a dependency — a theme flip must not restart the PTY.
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;

  // Repaint on theme change without tearing down the PTY.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERM_THEMES[resolvedTheme];
  }, [resolvedTheme]);

  useEffect(() => {
    if (!hostRef.current) return;
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12.5,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: TERM_THEMES[themeRef.current],
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    let alive = true;
    try {
      void api
        .ptySpawn(id, workspaceRoot, term.cols, term.rows, (data) => {
          if (alive) term.write(data);
        })
        .catch((e) => term.write(`\r\n[pty error: ${String(e)}]\r\n`));
    } catch (e) {
      // Channel creation can throw synchronously outside the Tauri runtime.
      term.write(`\r\n[pty unavailable: ${String(e)}]\r\n`);
    }

    const sub = term.onData((d) => {
      void api.ptyWrite(id, d).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void api.ptyResize(id, term.cols, term.rows).catch(() => {});
      } catch {
        /* the host can be mid-layout; the next observation fixes it */
      }
    });
    ro.observe(hostRef.current);
    term.focus();

    return () => {
      alive = false;
      ro.disconnect();
      sub.dispose();
      void api.ptyKill(id).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
    // Re-spawn on root change or explicit restart.
  }, [workspaceRoot, generation]);

  const cwdLabel = workspaceRoot
    ? workspaceRoot.split(/[/\\]/).pop()
    : t("terminalNoFolder");

  const clear = useCallback(() => termRef.current?.clear(), []);

  return (
    <div className="flex h-full flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="panel-header">
        <TerminalSquare size={14} className="shrink-0 text-[var(--color-text-dim)]" />
        <span className="panel-title">{t("terminalTitle")}</span>
        <span className="flex-1 truncate font-mono text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {cwdLabel}
        </span>
        <button className="icon-btn" title={t("terminalClear")} onClick={clear}>
          <Eraser size={14} />
        </button>
        <button
          className="icon-btn"
          title={t("terminalRestart")}
          onClick={() => setGeneration((g) => g + 1)}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="icon-btn"
          title={t("terminalHide")}
          onClick={() => toggleTerminal(false)}
        >
          <ChevronDown size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 p-2">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
}
