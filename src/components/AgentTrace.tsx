import { useState } from "react";
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { summarizeArgs, type AgentToolEvent } from "../lib/agent";
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

function Step({ event }: { event: AgentToolEvent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[event.name] ?? Wrench;
  const expandable = Boolean(event.result || event.thought);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--r-md)] border bg-[var(--color-surface)]",
        event.status === "error"
          ? "border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)]"
          : event.status === "declined"
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

        {event.status === "running" && (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-ai)]" />
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
