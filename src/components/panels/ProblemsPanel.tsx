import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Zap,
} from "../icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { restartServer } from "../../lib/lspManager";
import {
  discoverChecks,
  runCheck,
  type Check,
  type CheckRun,
  type Problem,
} from "../../lib/problems";

/** The check surface an IDE has and a chat does not: run the project's own
 *  type-check, linter and tests, and get a clickable list of what is broken.
 *
 *  Commands are discovered from the project (package.json scripts, Cargo.toml)
 *  rather than assumed, and they run in the same shell the agent uses. */
export function ProblemsPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const revealInFile = useStore((s) => s.revealInFile);
  const runs = useStore((s) => s.checkRuns);
  const setRun = useStore((s) => s.setCheckRun);
  const lspDiagnostics = useStore((s) => s.lspDiagnostics);
  const lspEntries = useMemo(
    () => Object.entries(lspDiagnostics).filter(([, d]) => d.length),
    [lspDiagnostics],
  );

  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root) {
      setChecks([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void discoverChecks(root)
      .then((c) => alive && setChecks(c))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [root]);

  const run = useCallback(
    async (check: Check) => {
      if (!root) return;
      setRun(check.id, { checkId: check.id, status: "running", problems: [] });
      const result = await runCheck(root, check);
      setRun(check.id, result);
    },
    [root, setRun],
  );

  const runAll = useCallback(async () => {
    // Sequentially: these are heavy commands and parallel npm runs fight over
    // the same caches and CPU.
    for (const c of checks) await run(c);
  }, [checks, run]);

  // Flatten the (small) list of checks and their (possibly large) problem lists
  // into one flat row list so the problems window can be virtualized.
  const rows = useMemo(
    () => flattenRows(checks, runs, collapsed),
    [checks, runs, collapsed],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 8,
    getItemKey: (index) => {
      const row = rows[index];
      switch (row.kind) {
        case "check":
          return `check:${row.check.id}`;
        case "problem":
          return `problem:${row.problem.file}:${row.problem.line}:${row.index}`;
        case "clean":
          return `clean:${row.checkId}`;
        case "output":
          return `output:${row.checkId}`;
      }
    },
  });

  if (!root)
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("problemsTitle")}</span>
        </header>
        <EmptyState
          icon={Zap}
          title={t("explorerNoFolder")}
          text={t("problemsNoFolderHint")}
          action={{
            label: t("explorerOpenFolder"),
            onClick: () => void pickWorkspaceFolder(),
          }}
        />
      </div>
    );

  const busy = checks.some((c) => runs[c.id]?.status === "running");

  const renderRow = (row: FlatRow) => {
    switch (row.kind) {
      case "check": {
        const c = row.check;
        const r = runs[c.id];
        const isCollapsed = collapsed[c.id];
        return (
          <div className={cn("group/ch flex items-center gap-1", row.spaced && "pb-1")}>
            <button
              className="row min-w-0 flex-1"
              onClick={() => setCollapsed((v) => ({ ...v, [c.id]: !v[c.id] }))}
              title={c.command}
            >
              {isCollapsed ? (
                <ChevronRight size={13} className="shrink-0 opacity-60" />
              ) : (
                <ChevronDown size={13} className="shrink-0 opacity-60" />
              )}
              <StatusDot run={r} />
              <span className="truncate">{c.label}</span>
              <CountBadge run={r} />
            </button>
            <button
              className="icon-btn h-6 w-6"
              title={t("problemsRun")}
              disabled={r?.status === "running"}
              onClick={() => void run(c)}
            >
              {r?.status === "running" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          </div>
        );
      }
      case "problem": {
        const p = row.problem;
        return (
          <div className={cn("pl-3", row.spaced && "pb-1")}>
            <button
              className="row items-start"
              onClick={() => revealInFile(p.file, p.line, p.column)}
              title={`${p.file}:${p.line}`}
            >
              {p.severity === "error" ? (
                <AlertCircle
                  size={12}
                  className="mt-0.5 shrink-0 text-[var(--color-danger)]"
                />
              ) : (
                <AlertTriangle
                  size={12}
                  className="mt-0.5 shrink-0 text-[var(--color-warning)]"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--fs-sm)] leading-snug">
                  {p.message}
                </span>
                <span className="block truncate text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                  {p.file.split(/[/\\]/).pop()}:{p.line}
                  {p.code ? ` · ${p.code}` : ""}
                </span>
              </span>
            </button>
          </div>
        );
      }
      case "clean":
        return (
          <div className={cn("pl-3", row.spaced && "pb-1")}>
            <p className="flex items-center gap-1.5 px-2 py-1 text-[length:var(--fs-xs)] text-[var(--color-success)]">
              <CheckCircle2 size={12} /> {t("problemsClean")}
            </p>
          </div>
        );
      case "output":
        return (
          <div className={cn("pl-3", row.spaced && "pb-1")}>
            {/* A failed command with nothing parseable is still useful —
                show the tail rather than pretending it passed. */}
            <pre className="mx-2 mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[length:var(--fs-2xs)] leading-snug text-[var(--color-text-dim)]">
              {row.output}
            </pre>
          </div>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">{t("problemsTitle")}</span>
        <button
          className="icon-btn"
          title={t("problemsRunAll")}
          disabled={busy || checks.length === 0}
          onClick={() => void runAll()}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        </button>
      </header>

      <p className="section-hint px-3 pt-2">{t("problemsWhat")}</p>

      <LanguageServers />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        {/* Live language-server diagnostics — updated as you type, no run
            needed — sit above the on-demand project checks. */}
        {lspEntries.length > 0 && (
          <div className="mb-2 pt-1">
            <div className="section-label flex items-center gap-1.5">
              <Zap size={11} /> {t("problemsLive")}
            </div>
            {lspEntries.map(([file, diags]) => (
              <div key={file} className="pl-3">
                <div className="truncate px-2 py-0.5 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                  {file.split(/[/\\]/).pop()}
                </div>
                {diags.map((d, i) => (
                  <button
                    key={i}
                    className="row items-start"
                    onClick={() => revealInFile(file, d.line, d.column)}
                    title={`${file}:${d.line}`}
                  >
                    {d.severity === "error" ? (
                      <AlertCircle size={12} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
                    ) : d.severity === "warning" ? (
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
                    ) : (
                      <AlertCircle size={12} className="mt-0.5 shrink-0 text-[var(--color-info)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:var(--fs-sm)] leading-snug">
                        {d.message}
                      </span>
                      <span className="block truncate text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                        {d.line}:{d.column}
                        {d.code ? ` · ${d.code}` : ""}
                        {d.source ? ` · ${d.source}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
            <Loader2 size={12} className="animate-spin" />
            {t("loading")}
          </div>
        )}

        {!loading && checks.length === 0 && (
          <p className="px-3 py-2 text-[length:var(--fs-xs)] leading-snug text-[var(--color-text-mute)]">
            {t("problemsNoChecks")}
          </p>
        )}

        {!loading && checks.length > 0 && (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {renderRow(rows[vi.index])}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Flattening: checks and their problems share one virtual list.
   -------------------------------------------------------------------------- */

type FlatRow =
  | { kind: "check"; check: Check; spaced?: boolean }
  | { kind: "problem"; problem: Problem; index: number; spaced?: boolean }
  | { kind: "clean"; checkId: string; spaced?: boolean }
  | { kind: "output"; checkId: string; output: string; spaced?: boolean };

function flattenRows(
  checks: Check[],
  runs: Record<string, CheckRun>,
  collapsed: Record<string, boolean>,
): FlatRow[] {
  const rows: FlatRow[] = [];

  for (const c of checks) {
    const r = runs[c.id];
    const body: FlatRow[] = [];

    if (!collapsed[c.id] && r && r.status !== "running") {
      if (r.problems.length > 0) {
        r.problems.forEach((p, i) =>
          body.push({ kind: "problem", problem: p, index: i }),
        );
      } else if (r.status === "ok") {
        body.push({ kind: "clean", checkId: c.id });
      } else if (r.output) {
        body.push({ kind: "output", checkId: c.id, output: r.output });
      }
    }

    const group: FlatRow[] = [{ kind: "check", check: c }, ...body];
    // Keep the visual gap that used to live on each <section>.
    group[group.length - 1].spaced = true;
    rows.push(...group);
  }

  return rows;
}

function StatusDot({ run }: { run?: CheckRun }) {
  const cls =
    run?.status === "ok"
      ? "bg-[var(--color-success)]"
      : run?.status === "failed"
        ? "bg-[var(--color-danger)]"
        : run?.status === "error"
          ? "bg-[var(--color-warning)]"
          : "bg-[var(--color-border-strong)]";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cls)} aria-hidden />;
}

function CountBadge({ run }: { run?: CheckRun }) {
  if (!run || run.status === "running" || run.problems.length === 0) return null;
  const errors = run.problems.filter((p) => p.severity === "error").length;
  return (
    <span className="badge ml-auto shrink-0" data-tone={errors ? "danger" : undefined}>
      {run.problems.length}
    </span>
  );
}


/** What each language server is doing.
 *
 *  Before this the visible states were "working" and "silently not working",
 *  and they look identical from the editor: no hover, no completion, no
 *  squiggles. A server that is missing owes the user an install line; one that
 *  crashed repeatedly and gave up owes them a button. Silence is what makes
 *  someone spend an afternoon wondering why hover stopped.
 */
function LanguageServers() {
  const t = useT();
  const servers = useStore((s) => s.lspServers);
  const [restarting, setRestarting] = useState<string | null>(null);
  const entries = Object.entries(servers);
  if (entries.length === 0) return null;

  return (
    <div className="border-b border-[var(--color-border)] px-1 pb-2 pt-1">
      <div className="section-label flex items-center gap-1.5">
        <Zap size={11} /> {t("lspServers")}
      </div>
      {entries.map(([key, server]) => (
        <div key={key} className="flex items-start gap-2 px-3 py-1">
          <span
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              server.status === "ready"
                ? "bg-[var(--color-ok,var(--color-accent))]"
                : server.status === "starting"
                  ? "bg-[var(--color-text-mute)]"
                  : "bg-[var(--color-danger)]",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[length:var(--fs-xs)] text-[var(--color-text)]">
              {server.label}
            </div>
            <div className="text-[length:var(--fs-2xs)] leading-relaxed text-[var(--color-text-mute)]">
              {server.status === "ready" && t("lspReady")}
              {server.status === "starting" && t("lspStarting")}
              {server.status === "missing" && (
                <>
                  {t("lspMissingHint")}{" "}
                  <code className="select-text font-mono">{server.install}</code>
                </>
              )}
              {server.status === "failed" &&
                t("lspFailed").replace("{n}", String(server.restarts ?? 1))}
              {server.status === "gaveUp" &&
                t("lspGaveUp").replace("{n}", String(server.restarts ?? 0))}
            </div>
          </div>
          {(server.status === "gaveUp" || server.status === "ready") && (
            <button
              className="btn btn-ghost btn-sm shrink-0"
              disabled={restarting === key}
              onClick={() => {
                setRestarting(key);
                void restartServer(key).finally(() => setRestarting(null));
              }}
            >
              {restarting === key ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                t("lspRestart")
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
