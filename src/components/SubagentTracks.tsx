import { Bot, Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useStore } from "../lib/store";
import { cn } from "../lib/cn";
import { useT } from "../lib/i18n";
import type { SubagentRun } from "../lib/types";

/** Helper agents, one row each.
 *
 *  Parallel runs without this are a black box: three models change files at
 *  once and the only visible sign is that the lead goes quiet for a minute.
 *  The row says who is working, on what tool, and for how long — enough to
 *  tell "thinking" from "stuck". */
export function SubagentTracks() {
  const t = useT();
  const runs = useStore((s) => s.subagents);
  const list = Object.values(runs).sort((a, b) => a.startedAt - b.startedAt);
  if (!list.length) return null;

  const done = list.filter((r) => r.status !== "running").length;

  return (
    <div className="mx-2 my-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <Bot size={13} className="text-[var(--color-ai)]" />
        <span className="text-[length:var(--fs-xs)] font-semibold uppercase tracking-[0.07em] text-[var(--color-text-dim)]">
          {t("subagentsTitle")}
        </span>
        <span className="badge ml-auto">
          {done}/{list.length}
        </span>
      </div>
      {/* A bar for the batch as a whole: with three helpers going at once, the
          question is "how far along is this", not "what is each one doing". */}
      <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full bg-[var(--color-ai)] transition-[width] duration-500"
          style={{ width: `${Math.round((done / list.length) * 100)}%` }}
        />
      </div>
      <div className="space-y-1">
        {list.map((r) => (
          <Track key={r.id} run={r} />
        ))}
      </div>
    </div>
  );
}

function Track({ run }: { run: SubagentRun }) {
  const t = useT();
  const seconds = Math.round((Date.now() - run.startedAt) / 1000);

  const icon =
    run.status === "running" ? (
      <Loader2 size={12} className="animate-spin text-[var(--color-ai)]" />
    ) : run.status === "done" ? (
      <Check size={12} className="text-[var(--color-success)]" />
    ) : run.status === "failed" ? (
      <TriangleAlert size={12} className="text-[var(--color-danger)]" />
    ) : (
      <X size={12} className="text-[var(--color-text-mute)]" />
    );

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[var(--r-sm)] px-1.5 py-1 transition-colors",
        run.status === "running" &&
          "bg-[color-mix(in_srgb,var(--color-ai)_10%,transparent)]",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{run.title}</span>
          {run.status === "running" && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-ai)] opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ai)]" />
            </span>
          )}
        </span>
        <span className="block truncate text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
          {run.model}
          {run.tool ? ` · ${run.tool}` : ""} · {t("subagentSteps", { n: String(run.steps) })}
          {run.status === "running" ? ` · ${seconds}${t("secondsShort")}` : ""}
        </span>
        {/* The reason, in full, on the row that failed — the lead's retelling
            of it ("ran out of limit") was not what actually happened. */}
        {run.error && (
          <span
            className="mt-0.5 block text-[length:var(--fs-2xs)] leading-snug text-[var(--color-danger)]"
            title={run.error}
          >
            {run.error === "budget"
              ? t("subagentBudget")
              : run.error === "stopped"
                ? t("subagentStopped")
                : run.error}
          </span>
        )}
      </span>
    </div>
  );
}
