import { useEffect, useState } from "react";
import { Loader2, Plus, Minus, Trash2 } from "../icons";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import {
  discardHunk,
  fileHunks,
  stageHunk,
  unstageHunk,
  type FileDiff,
  type Hunk,
} from "../../lib/hunks";

/** The hunks of one file, each with its own stage/discard.
 *
 *  This is what `git add -p` does, without the terminal prompt: staging a whole
 *  file when you only meant one change is how an unrelated edit rides into a
 *  commit. Expanded inline under a file row rather than in a separate view, so
 *  the decision is made where the file is listed.
 */
export function HunkList({
  root,
  path,
  staged,
  onChanged,
}: {
  root: string;
  path: string;
  staged: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fileHunks(root, path, staged)
      .then(setDiff)
      .catch((e) => setError(String(e)));
  };

  useEffect(load, [root, path, staged]);

  const act = async (index: number, fn: () => Promise<void>) => {
    setBusy(index);
    setError(null);
    try {
      await fn();
      onChanged();
      load();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, "").slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="alert mx-2 my-1 text-[length:var(--fs-2xs)]">{error}</div>;
  if (!diff) return null;
  if (diff.hunks.length === 0)
    return (
      <p className="px-4 py-1 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
        {t("gitNoHunks")}
      </p>
    );

  return (
    <div className="ml-4 border-l border-[var(--color-border)] pl-1">
      {diff.hunks.map((hunk: Hunk, i) => (
        <div key={i} className="my-1">
          <div className="flex items-center gap-1 px-1">
            <span className="flex-1 truncate font-mono text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
              {hunk.header.replace(/@@ (.+?) @@.*/, "$1")}
              <span className="ml-1.5 text-[var(--color-added,var(--color-accent))]">+{hunk.added}</span>
              <span className="ml-1 text-[var(--color-danger)]">−{hunk.removed}</span>
            </span>
            {busy === i ? (
              <Loader2 size={12} className="animate-spin text-[var(--color-text-mute)]" />
            ) : staged ? (
              <button
                className="icon-btn h-5 w-5"
                title={t("gitUnstageHunk")}
                onClick={() => void act(i, () => unstageHunk(root, diff, hunk))}
              >
                <Minus size={12} />
              </button>
            ) : (
              <>
                <button
                  className="icon-btn h-5 w-5"
                  title={t("gitStageHunk")}
                  onClick={() => void act(i, () => stageHunk(root, diff, hunk))}
                >
                  <Plus size={12} />
                </button>
                <button
                  className="icon-btn h-5 w-5 hover:text-[var(--color-danger)]"
                  title={t("gitDiscardHunk")}
                  onClick={() => {
                    // Discard has no undo — git keeps no record of a
                    // working-tree change it never committed.
                    if (confirm(t("gitDiscardHunkConfirm")))
                      void act(i, () => discardHunk(root, diff, hunk));
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
          <pre className="overflow-x-auto px-1 font-mono text-[length:var(--fs-2xs)] leading-[1.4]">
            {hunk.lines.map((line, j) => (
              <div
                key={j}
                className={cn(
                  line.startsWith("+") && "bg-[var(--color-added-bg,rgba(0,180,0,0.08))] text-[var(--color-added,var(--color-accent))]",
                  line.startsWith("-") && "bg-[var(--color-removed-bg,rgba(220,0,0,0.08))] text-[var(--color-danger)]",
                  line.startsWith("+") || line.startsWith("-") ? "" : "text-[var(--color-text-dim)]",
                )}
              >
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
