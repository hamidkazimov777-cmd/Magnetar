import { useEffect, useRef, useState } from "react";
import { GitBranch, Plus, Check, Trash2, Loader2, Archive } from "../icons";
import { useT } from "../../lib/i18n";
import {
  checkout,
  createBranch,
  deleteBranch,
  gitError,
  listBranches,
  listStashes,
  merge,
  rebase,
  stashDrop,
  stashPop,
  stashPush,
  type Branch,
  type Stash,
} from "../../lib/git";

/** The branch this repo is on, with everything you do to branches hanging off
 *  it: switch, create, delete, and — because they act between two branches —
 *  merge and rebase the current branch onto another.
 */
export function GitBranches({
  root,
  current,
  onChanged,
}: {
  root: string;
  current: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const load = () => {
    void listBranches(root).then(setBranches);
    void listStashes(root).then(setStashes);
  };

  useEffect(() => {
    if (open) load();
  }, [open, root]);

  // Close on an outside click, like every other menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const act = async (fn: () => Promise<{ ok: boolean } & Parameters<typeof gitError>[0]>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(gitError(r));
      else onChanged();
      load();
    } finally {
      setBusy(false);
    }
  };

  const locals = branches.filter((b) => !b.remote);
  const remotes = branches.filter((b) => b.remote);

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="flex min-w-0 items-center gap-1.5"
        onClick={() => setOpen((v) => !v)}
        title={t("gitBranches")}
      >
        <GitBranch size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="truncate text-[length:var(--fs-base)] font-medium">{current || "—"}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[70vh] w-72 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
          {error && <div className="alert mx-2 my-1 text-[length:var(--fs-2xs)]">{error}</div>}

          {creating ? (
            <div className="flex items-center gap-1 px-2 py-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    void act(() => createBranch(root, newName.trim()));
                    setNewName("");
                    setCreating(false);
                  }
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder={t("gitNewBranchName")}
                className="h-7 w-full rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[length:var(--fs-xs)] outline-none"
              />
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[length:var(--fs-xs)] hover:bg-[var(--color-surface-2)]"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} /> {t("gitNewBranch")}
            </button>
          )}

          <div className="section-label px-3">{t("gitLocalBranches")}</div>
          {locals.map((b) => (
            <div key={b.name} className="group/br flex items-center px-1">
              <button
                className="row min-w-0 flex-1"
                onClick={() => !b.current && void act(() => checkout(root, b.name))}
                title={b.upstream ? `→ ${b.upstream}` : undefined}
              >
                {b.current ? (
                  <Check size={12} className="shrink-0 text-[var(--color-accent)]" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="truncate">{b.name}</span>
                {(b.ahead > 0 || b.behind > 0) && (
                  <span className="ml-auto shrink-0 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                    {b.ahead > 0 && `↑${b.ahead}`} {b.behind > 0 && `↓${b.behind}`}
                  </span>
                )}
              </button>
              {!b.current && (
                <span className="flex shrink-0 opacity-0 group-hover/br:opacity-100">
                  <button
                    className="icon-btn h-6 w-6"
                    title={t("gitMergeInto").replace("{branch}", current)}
                    onClick={() => void act(() => merge(root, b.name))}
                  >
                    ⛙
                  </button>
                  <button
                    className="icon-btn h-6 w-6"
                    title={t("gitRebaseOnto").replace("{branch}", b.name)}
                    onClick={() => void act(() => rebase(root, b.name))}
                  >
                    ⤵
                  </button>
                  <button
                    className="icon-btn h-6 w-6 hover:text-[var(--color-danger)]"
                    title={t("gitDeleteBranch")}
                    onClick={() => {
                      // -d refuses to drop an unmerged branch; the error says so
                      // and the user can retry with force from the terminal —
                      // this button never force-deletes silently.
                      void act(() => deleteBranch(root, b.name));
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}

          {remotes.length > 0 && (
            <>
              <div className="section-label px-3">{t("gitRemoteBranches")}</div>
              {remotes.map((b) => (
                <button
                  key={b.name}
                  className="row w-full"
                  onClick={() =>
                    void act(() => createBranch(root, b.name.replace(/^[^/]+\//, ""), b.name))
                  }
                  title={t("gitCheckoutRemote")}
                >
                  <span className="w-3 shrink-0" />
                  <span className="truncate text-[var(--color-text-dim)]">{b.name}</span>
                </button>
              ))}
            </>
          )}

          <div className="section-label flex items-center gap-1.5 px-3">
            <Archive size={11} /> {t("gitStashes")}
            <button
              className="ml-auto text-[length:var(--fs-2xs)] text-[var(--color-accent)] hover:underline"
              onClick={() => void act(() => stashPush(root))}
            >
              {t("gitStashPush")}
            </button>
          </div>
          {stashes.length === 0 ? (
            <p className="px-3 py-1 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
              {t("gitNoStashes")}
            </p>
          ) : (
            stashes.map((st) => (
              <div key={st.index} className="group/st flex items-center px-1">
                <span className="row min-w-0 flex-1 truncate text-[length:var(--fs-xs)]" title={st.message}>
                  {st.message}
                </span>
                <span className="flex shrink-0 opacity-0 group-hover/st:opacity-100">
                  <button
                    className="icon-btn h-6 w-6"
                    title={t("gitStashPop")}
                    onClick={() => void act(() => stashPop(root, st.index))}
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    className="icon-btn h-6 w-6 hover:text-[var(--color-danger)]"
                    title={t("gitStashDrop")}
                    onClick={() => void act(() => stashDrop(root, st.index))}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))
          )}

          {busy && (
            <div className="flex justify-center py-1">
              <Loader2 size={13} className="animate-spin text-[var(--color-text-mute)]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

