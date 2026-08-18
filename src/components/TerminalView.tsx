import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";

export function TerminalView() {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#0a0a10",
        foreground: "#ececf4",
        cursor: "#a99cff",
        selectionBackground: "#8b7ff555",
        black: "#15151f",
        brightBlack: "#4a4a60",
        blue: "#8b7ff5",
        brightBlue: "#a99cff",
        green: "#5be0a0",
        magenta: "#c48bff",
        cyan: "#7fd6e0",
        white: "#ececf4",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    let alive = true;
    api
      .ptySpawn(id, workspaceRoot, term.cols, term.rows, (data) => {
        if (alive) term.write(data);
      })
      .catch((e) => term.write(`\r\n[pty error: ${String(e)}]\r\n`));

    const sub = term.onData((d) => {
      void api.ptyWrite(id, d).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void api.ptyResize(id, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
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
    };
    // Re-spawn when the workspace root changes.
  }, [workspaceRoot]);

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-dim)]">
        {t("terminal")}
        {workspaceRoot && (
          <span className="truncate font-mono text-xs">
            · {workspaceRoot.split(/[/\\]/).pop()}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 bg-[#0a0a10] p-2">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
}
