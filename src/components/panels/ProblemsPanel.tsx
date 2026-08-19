import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { discoverChecks, runCheck, type Check, type CheckRun } from "../../lib/problems";

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

  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  if (!root)
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("problemsTitle")}</span>
        </header>
        <EmptyState
          icon={AlertCircle}
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

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
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

        {checks.map((c) => {
          const r = runs[c.id];
          const isCollapsed = collapsed[c.id];
          return (
            <section key={c.id} className="mb-1">
              <div className="group/ch flex items-center gap-1">
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

              {!isCollapsed && r && r.status !== "running" && (
                <div className="pl-3">
                  {r.problems.map((p, i) => (
                    <button
                      key={`${p.file}:${p.line}:${i}`}
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
                  ))}

                  {r.problems.length === 0 && r.status === "ok" && (
                    <p className="flex items-center gap-1.5 px-2 py-1 text-[length:var(--fs-xs)] text-[var(--color-success)]">
                      <CheckCircle2 size={12} /> {t("problemsClean")}
                    </p>
                  )}

                  {/* A failed command with nothing parseable is still useful —
                      show the tail rather than pretending it passed. */}
                  {r.problems.length === 0 && r.status !== "ok" && r.output && (
                    <pre className="mx-2 mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[length:var(--fs-2xs)] leading-snug text-[var(--color-text-dim)]">
                      {r.output}
                    </pre>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
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
