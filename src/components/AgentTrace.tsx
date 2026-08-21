import { useEffect, useState } from "react";
import {
  FileText,
  FolderTree,
  Search,
  FileSearch,
  FilePlus2,
  FilePenLine,
  TerminalSquare,
  Paperclip,
  Wrench,
  Loader2,
  Check,
  X,
  Ban,
  ChevronRight,
  Square,
  MessageCircleQuestion,
  GitCompare,
  Users,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { summarizeArgs, type AgentToolEvent } from "../lib/agent";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";

const ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  list_dir: FolderTree,
  grep: Search,
  search_code: FileSearch,
  write_file: FilePlus2,
  edit_file: FilePenLine,
  run_bash: TerminalSquare,
  attach_file: Paperclip,
  ask_decision: MessageCircleQuestion,
  flag_memory: GitCompare,
  delegate: Users,
};

/** The agent's run, rendered as a sequence of steps: which tool, on what, and
 *  how it ended. Expand a step to read the raw output it fed back to the model. */
export function AgentTrace({ events }: { events: AgentToolEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="my-2 space-y-1">
      {events.map((e) => (
        <Step key={e.id} event={e} />
      ))}
    </div>
  );
}

/** Live counter on a running step. A command with no visible progress and no
 *  elapsed time is indistinguishable from a hang — this is the difference. */
function ElapsedBadge({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  if (!startedAt) return null;
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[length:var(--fs-2xs)] tabular-nums",
        secs > 30 ? "text-[var(--color-warning)]" : "text-[var(--color-text-mute)]",
      )}
    >
      {secs}с
    </span>
  );
}

/** Kill the shell command this step is running. The agent loop is blocked on
 *  it, so this is also what unblocks the conversation. */
function KillButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-danger btn-sm mb-2"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api.toolKillBash().catch(() => {});
      }}
    >
      <Square size={12} />
      {t("agentKillCommand")}
    </button>
  );
}

function Step({ event }: { event: AgentToolEvent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[event.name] ?? Wrench;
  // A running command is worth expanding too: that is where the user reads the
  // full command line and reaches the stop button.
  const expandable = Boolean(event.result || event.thought || event.status === "running");
  const running = event.status === "running";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--r-md)] border bg-[var(--color-surface)]",
        event.status === "error"
          ? "border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)]"
          : event.status === "declined" || event.status === "blocked"
            ? "border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)]"
            : "border-[var(--color-border)]",
      )}
    >
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          expandable && "hover:bg-[var(--color-surface-2)]",
        )}
        disabled={!expandable}
      >
        <Icon size={13} className="shrink-0 text-[var(--color-ai)]" />
        <span className="shrink-0 font-mono text-[length:var(--fs-sm)] text-[var(--color-text)]">
          {event.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {summarizeArgs(event.name, event.args)}
        </span>

        {running && (
          <>
            <ElapsedBadge startedAt={event.startedAt} />
            <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-ai)]" />
          </>
        )}
        {event.status === "killed" && (
          <span className="flex shrink-0 items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-warning)]">
            <Square size={11} />
            {t("agentKilledByUser")}
          </span>
        )}
        {event.durationMs != null && event.status !== "running" && event.durationMs > 1500 && (
          <span className="shrink-0 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
            {Math.round(event.durationMs / 1000)}с
          </span>
        )}
        {event.status === "done" && (
          <Check size={12} className="shrink-0 text-[var(--color-success)]" />
        )}
        {event.status === "error" && (
          <X size={12} className="shrink-0 text-[var(--color-danger)]" />
        )}
        {event.status === "declined" && (
          <span className="flex shrink-0 items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-warning)]">
            <Ban size={12} />
            {t("agentDeclinedByUser")}
          </span>
        )}
        {/* The app refused this itself. Saying "declined by the user" here told
            people they had rejected something they were never shown. */}
        {event.status === "blocked" && (
          <span className="flex shrink-0 items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-warning)]">
            <ShieldAlert size={12} />
            {t("agentBlocked")}
          </span>
        )}

        {expandable && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-[var(--color-text-mute)] transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2">
          {/* The full command, not the truncated one-liner from the row. */}
          {typeof event.args.command === "string" && (
            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text)]">
              {event.args.command}
            </pre>
          )}

          {running && event.name === "run_bash" && <KillButton />}

          {event.thought && (
            <p className="mb-2 text-[length:var(--fs-sm)] italic leading-relaxed text-[var(--color-text-dim)]">
              {event.thought}
            </p>
          )}
          {event.result && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-dim)]">
              {event.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
