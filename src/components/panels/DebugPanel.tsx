import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  ArrowDownToLine,
  Loader2,
  FolderGit2,
  Bug,
} from "../icons";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { api } from "../../lib/api";
import { DebugSession } from "../../lib/debug/session";
import {
  ADAPTERS,
  debuggerForFile,
  launchConfig,
  type DebuggerId,
} from "../../lib/debug/adapters";

/** The debugger: start a session on the active file, then breakpoints, call
 *  stack, variables, watches and a console.
 *
 *  The session lives in a ref, not the store — a DAP client is not serialisable
 *  state, and only one runs at a time. The store holds what the UI renders
 *  (status, stack, variables, output); this panel owns the live object.
 */
export function DebugPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const status = useStore((s) => s.debugStatus);
  const setStatus = useStore((s) => s.setDebugStatus);
  const callStack = useStore((s) => s.callStack);
  const setCallStack = useStore((s) => s.setCallStack);
  const activeFrame = useStore((s) => s.activeFrame);
  const setActiveFrame = useStore((s) => s.setActiveFrame);
  const variables = useStore((s) => s.variables);
  const setVariables = useStore((s) => s.setVariables);
  const consoleLines = useStore((s) => s.debugConsole);
  const pushConsole = useStore((s) => s.pushConsole);
  const clearConsole = useStore((s) => s.clearConsole);
  const setStopReason = useStore((s) => s.setStopReason);
  const stopReason = useStore((s) => s.stopReason);
  const revealInFile = useStore((s) => s.revealInFile);
  const watches = useStore((s) => s.watches);
  const addWatch = useStore((s) => s.addWatch);
  const removeWatch = useStore((s) => s.removeWatch);

  const session = useRef<DebugSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consoleInput, setConsoleInput] = useState("");
  const [watchInput, setWatchInput] = useState("");

  // The frame whose variables are shown.
  useEffect(() => {
    const s = session.current;
    if (!s || status !== "paused") return;
    const frame = activeFrame ?? callStack[0]?.id;
    if (frame == null) return;
    void (async () => {
      const scopes = await s.scopes(frame);
      const all = await Promise.all(scopes.map((sc) => s.variables(sc.variablesReference)));
      setVariables(all.flat());
    })();
  }, [activeFrame, status, callStack, setVariables]);

  const refreshStopped = async (reason: string) => {
    const s = session.current;
    if (!s) return;
    setStatus("paused");
    setStopReason(reason);
    const frames = await s.stackTrace();
    setCallStack(frames);
    // Jump to where execution stopped, the way hitting a breakpoint should.
    const top = frames[0];
    if (top?.path) revealInFile(top.path, top.line);
  };

  const start = async () => {
    if (!root) return;
    const active = useStore.getState();
    const path = active.tabs.find((x) => x.path === active.activeTabPath)?.path;
    if (!path) {
      setError(t("debugNoFile"));
      return;
    }
    const dbg = debuggerForFile(path);
    if (!dbg) {
      setError(t("debugUnsupported"));
      return;
    }
    const spec = ADAPTERS[dbg];
    if (!spec.ready) {
      setError(t("debugAdapterMissing").replace("{install}", spec.install));
      return;
    }
    // The adapter binary has to be there.
    const found = await api.lspWhich(spec.probe).catch(() => null);
    if (!found) {
      setError(t("debugProbeMissing").replace("{install}", spec.install));
      return;
    }

    setError(null);
    clearConsole();
    setStatus("starting");
    const sess = new DebugSession(dbg, {
      onStopped: (reason) => void refreshStopped(reason),
      onRunning: () => setStatus("running"),
      onOutput: (text, category) => pushConsole({ text, category }),
      onTerminated: () => {
        setStatus("ended");
        setCallStack([]);
        setVariables([]);
      },
    });
    session.current = sess;
    try {
      const bps = new Map<string, number[]>(Object.entries(useStore.getState().breakpoints));
      await sess.start(spec, launchConfig(dbg as DebuggerId, path, root), bps);
      setStatus("running");
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, "").slice(0, 200));
      setStatus("idle");
    }
  };

  const stop = async () => {
    await session.current?.stop().catch(() => {});
    session.current = null;
    setStatus("idle");
    setCallStack([]);
    setVariables([]);
  };

  const control = (fn: (s: DebugSession) => Promise<unknown>) => () => {
    if (session.current) void fn(session.current);
  };

  const evalConsole = async () => {
    const expr = consoleInput.trim();
    if (!expr || !session.current) return;
    pushConsole({ text: `› ${expr}`, category: "input" });
    setConsoleInput("");
    try {
      const result = await session.current.evaluate(expr, activeFrame ?? callStack[0]?.id);
      pushConsole({ text: result, category: "result" });
    } catch (e) {
      pushConsole({ text: String(e).replace(/^Error:\s*/, ""), category: "stderr" });
    }
  };

  if (!root)
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("debugTitle")}</span>
        </header>
        <EmptyState
          icon={FolderGit2}
          title={t("explorerNoFolder")}
          action={{ label: t("explorerOpenFolder"), onClick: () => void pickWorkspaceFolder() }}
        />
      </div>
    );

  const running = status === "running" || status === "paused" || status === "starting";

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header gap-1">
        <span className="panel-title flex-1">{t("debugTitle")}</span>
        {!running ? (
          <button className="icon-btn" title={t("debugStart")} onClick={() => void start()}>
            <Play size={14} className="text-[var(--color-accent)]" />
          </button>
        ) : (
          <>
            <button
              className="icon-btn"
              title={t("debugContinue")}
              disabled={status !== "paused"}
              onClick={control((s) => s.continue())}
            >
              <Play size={14} className={status === "paused" ? "text-[var(--color-accent)]" : "opacity-40"} />
            </button>
            <button className="icon-btn" title={t("debugStepOver")} disabled={status !== "paused"} onClick={control((s) => s.next())}>
              <span className="text-[length:var(--fs-sm)]">⤼</span>
            </button>
            <button className="icon-btn" title={t("debugStepInto")} disabled={status !== "paused"} onClick={control((s) => s.stepIn())}>
              <ArrowDownToLine size={13} />
            </button>
            <button className="icon-btn" title={t("debugStepOut")} disabled={status !== "paused"} onClick={control((s) => s.stepOut())}>
              <span className="text-[length:var(--fs-sm)]">⤴</span>
            </button>
            <button className="icon-btn hover:text-[var(--color-danger)]" title={t("debugStop")} onClick={() => void stop()}>
              <Square size={13} />
            </button>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="alert mx-2 my-2 text-[length:var(--fs-xs)]">{error}</div>}

        {status === "idle" && !error && (
          <p className="px-3 py-6 text-center text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
            {t("debugHint")}
          </p>
        )}

        {status === "starting" && (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="animate-spin text-[var(--color-text-mute)]" />
          </div>
        )}

        {status === "paused" && stopReason && (
          <p className="px-3 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-warning,var(--color-text-dim))]">
            {t("debugPausedOn").replace("{reason}", stopReason)}
          </p>
        )}

        {callStack.length > 0 && (
          <Section title={t("debugCallStack")}>
            {callStack.map((f) => (
              <button
                key={f.id}
                className={cn(
                  "row w-full text-[length:var(--fs-xs)]",
                  activeFrame === f.id && "bg-[var(--color-surface-2)]",
                )}
                onClick={() => {
                  setActiveFrame(f.id);
                  if (f.path) revealInFile(f.path, f.line);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-[var(--color-text-mute)]">
                  {f.path?.split("/").pop()}:{f.line}
                </span>
              </button>
            ))}
          </Section>
        )}

        {status === "paused" && (
          <Section title={t("debugVariables")}>
            {variables.length === 0 ? (
              <p className="px-3 py-1 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">—</p>
            ) : (
              variables.map((v, i) => (
                <div key={i} className="flex items-baseline gap-2 px-3 py-0.5 text-[length:var(--fs-xs)]">
                  <span className="shrink-0 font-mono text-[var(--color-accent)]">{v.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-text-dim)]" title={v.value}>
                    {v.value}
                  </span>
                </div>
              ))
            )}
          </Section>
        )}

        <Section title={t("debugWatch")}>
          {watches.map((w) => (
            <Watch key={w} expr={w} session={session} frame={activeFrame ?? callStack[0]?.id} onRemove={() => removeWatch(w)} />
          ))}
          <div className="px-2 py-1">
            <input
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && watchInput.trim()) {
                  addWatch(watchInput.trim());
                  setWatchInput("");
                }
              }}
              placeholder={t("debugAddWatch")}
              className="h-6 w-full rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 font-mono text-[length:var(--fs-2xs)] outline-none"
            />
          </div>
        </Section>
      </div>

      {/* Debug console */}
      <div className="flex max-h-[40%] shrink-0 flex-col border-t border-[var(--color-border)]">
        <div className="section-label flex items-center gap-1.5 px-3">
          <Bug size={11} /> {t("debugConsole")}
          {consoleLines.length > 0 && (
            <button className="ml-auto text-[length:var(--fs-2xs)] hover:underline" onClick={clearConsole}>
              {t("clear")}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-1 font-mono text-[length:var(--fs-2xs)] leading-[1.5]">
          {consoleLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.category === "stderr" && "text-[var(--color-danger)]",
                line.category === "input" && "text-[var(--color-accent)]",
                line.category === "result" && "text-[var(--color-text)]",
                !["stderr", "input", "result"].includes(line.category) && "text-[var(--color-text-dim)]",
              )}
            >
              {line.text.replace(/\n$/, "")}
            </div>
          ))}
        </div>
        <input
          value={consoleInput}
          onChange={(e) => setConsoleInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void evalConsole()}
          disabled={status !== "paused"}
          placeholder={status === "paused" ? t("debugEval") : t("debugEvalPaused")}
          className="h-7 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-2 font-mono text-[length:var(--fs-2xs)] outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] pb-1">
      <div className="section-label">{title}</div>
      {children}
    </div>
  );
}

function Watch({
  expr,
  session,
  frame,
  onRemove,
}: {
  expr: string;
  session: React.MutableRefObject<DebugSession | null>;
  frame?: number;
  onRemove: () => void;
}) {
  const [value, setValue] = useState<string>("");
  useEffect(() => {
    if (!session.current || frame == null) {
      setValue("");
      return;
    }
    void session.current
      .evaluate(expr, frame)
      .then(setValue)
      .catch(() => setValue("—"));
  }, [expr, frame, session]);

  return (
    <div className="group/w flex items-baseline gap-2 px-3 py-0.5 text-[length:var(--fs-xs)]">
      <span className="shrink-0 font-mono text-[var(--color-accent)]">{expr}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-text-dim)]">{value || "—"}</span>
      <button className="shrink-0 opacity-0 group-hover/w:opacity-100 hover:text-[var(--color-danger)]" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
