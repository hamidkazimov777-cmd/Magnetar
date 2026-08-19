import { useState } from "react";
import {
  FilePlus2,
  FilePenLine,
  Undo2,
  CheckCheck,
  Loader2,
  History,
} from "lucide-react";
import { api } from "../../lib/api";
import { useStore, type FileChange } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";

/** Everything the agent changed on disk, newest first, with per-file undo.
 *  This is what makes auto-applied edits safe: nothing is hidden, and any
 *  single change can be rolled back to its exact previous content. */
export function ChangesPanel() {
  const t = useT();
  const changes = useStore((s) => s.changes);
  const markReverted = useStore((s) => s.markReverted);
  const clearChanges = useStore((s) => s.clearChanges);
  const openTab = useStore((s) => s.openTab);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = changes.filter((c) => !c.reverted);

  const revert = async (c: FileChange) => {
    setBusy(c.id);
    setError(null);
    try {
      if (c.before === null) await api.toolDeleteFile(c.path);
      else await api.toolWriteFile(c.path, c.before);
      markReverted(c.id);
      refreshExplorer();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const revertAll = async () => {
    // Newest first: later edits must be undone before earlier ones.
    for (const c of [...pending].reverse()) await revert(c);
  };

  if (changes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("changesTitle")}</span>
        </header>
        <EmptyState icon={History} title={t("changesEmpty")} text={t("changesEmptyHint")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">
          {t("changesTitle")} · {pending.length}
        </span>
        <button
          className="icon-btn"
          title={t("changesKeepAll")}
          onClick={clearChanges}
          disabled={busy !== null}
        >
          <CheckCheck size={14} />
        </button>
        <button
          className="icon-btn hover:text-[var(--color-danger)]"
          title={t("changesRevertAll")}
          onClick={() => void revertAll()}
          disabled={busy !== null || pending.length === 0}
        >
          <Undo2 size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {error && <div className="alert my-2 text-[length:var(--fs-xs)]">{error}</div>}

        {[...changes].reverse().map((c) => (
          <div
            key={c.id}
            className={cn(
              "group/ch relative mb-1 flex items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5",
              c.reverted ? "opacity-45" : "hover:bg-[var(--color-surface-2)]",
            )}
          >
            {c.before === null ? (
              <FilePlus2 size={13} className="shrink-0 text-[var(--color-added)]" />
            ) : (
              <FilePenLine size={13} className="shrink-0 text-[var(--color-modified)]" />
            )}

            <button
              className="min-w-0 flex-1 text-left"
              title={c.path}
              onClick={() =>
                openTab({
                  path: c.path,
                  name: c.path.split(/[/\\]/).pop() || c.path,
                  kind: "file",
                })
              }
            >
              <div
                className={cn(
                  "truncate text-[length:var(--fs-base)]",
                  c.reverted && "line-through",
                )}
              >
                {c.path.split(/[/\\]/).pop()}
              </div>
              <div className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                {c.before === null ? t("changesCreated") : t("changesEdited")}
              </div>
            </button>

            {!c.reverted && (
              <button
                className="icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover/ch:opacity-100 hover:text-[var(--color-danger)]"
                title={t("changesRevert")}
                onClick={() => void revert(c)}
                disabled={busy !== null}
              >
                {busy === c.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Undo2 size={12} />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
