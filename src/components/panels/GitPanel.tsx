import { useCallback, useEffect, useState } from "react";
import {
  GitBranch,
  Plus,
  Minus,
  RefreshCw,
  GitCommit,
  FileQuestion,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCcwDot,
  History,
  FolderGit2,
  Loader2,
  GitCompare,
  ShieldCheck,
} from "../icons";
import { HunkList } from "./HunkList";
import { GitBranches } from "./GitBranches";
import {
  abort,
  continueOp,
  repoState,
  signingStatus,
  type RepoState,
  type SigningStatus,
} from "../../lib/git";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { pickWorkspaceFolder } from "./ExplorerPanel";

interface Entry {
  path: string;
  code: string;
}

export function GitPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const openTab = useStore((s) => s.openTab);
  const refreshExplorer = useStore((s) => s.refreshExplorer);

  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [hasRemote, setHasRemote] = useState(false);
  const [staged, setStaged] = useState<Entry[]>([]);
  const [unstaged, setUnstaged] = useState<Entry[]>([]);
  const [untracked, setUntracked] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [notRepo, setNotRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which file's hunks are expanded for per-hunk staging. One at a time keeps
   *  the panel readable. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** A merge/rebase/cherry-pick in progress, and which files are conflicted.
   *  Drives the banner that turns a stuck repository into two buttons. */
  const [state, setState] = useState<RepoState>({ operation: null, conflicts: [] });
  /** Whether commits are configured to be signed. Read, not tested: detecting
   *  whether signing works would mean a trial commit, and what is configured
   *  is honest without touching the repository. */
  const [signing, setSigning] = useState<SigningStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setBusy(true);
    try {
      const st = await api.gitExec(root, ["status", "--porcelain=v1", "-b"]);
      if (st.code !== 0 && /not a git repository/i.test(st.stderr)) {
        setNotRepo(true);
        return;
      }
      setNotRepo(false);
      const s: Entry[] = [];
      const u: Entry[] = [];
      const un: string[] = [];
      let br = "";
      let ah = 0;
      let bh = 0;
      for (const line of st.stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("## ")) {
          const head = line.slice(3);
          br = head.split("...")[0].split(" ")[0];
          // "## main...origin/main [ahead 2, behind 1]"
          ah = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
          bh = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
          continue;
        }
        const x = line[0];
        const y = line[1];
        const p = line.slice(3);
        if (line.startsWith("??")) un.push(p);
        else {
          if (x !== " ") s.push({ path: p, code: x });
          if (y !== " ") u.push({ path: p, code: y });
        }
      }
      setBranch(br);
      setAhead(ah);
      setBehind(bh);
      setStaged(s);
      setUnstaged(u);
      setUntracked(un);

      const remotes = await api.gitExec(root, ["remote"]);
      setHasRemote(remotes.stdout.trim().length > 0);

      const lg = await api.gitExec(root, ["log", "--oneline", "-12"]);
      setLog(lg.stdout.split("\n").filter(Boolean));

      setState(await repoState(root));
      setSigning(await signingStatus(root));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (args: string[]) => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.gitExec(root, args);
      if (res.code !== 0 && res.stderr.trim())
        setError(res.stderr.trim().slice(0, 300));
    } catch (e) {
      setError(String(e));
    } finally {
      await refresh();
      refreshExplorer();
    }
  };

  const showDiff = (path: string, isStaged: boolean) =>
    openTab({
      path,
      name: path.split("/").pop() || path,
      kind: "diff",
      staged: isStaged,
    });

  const commit = async () => {
    if (!msg.trim() || staged.length === 0) return;
    // Sign when the repo is configured to. -S is added rather than trusting
    // commit.gpgsign so it works even when only user.signingkey is set, and
    // git's own error is shown if the key is unusable.
    await run(["commit", ...(signing?.enabled ? ["-S"] : []), "-m", msg.trim()]);
    setMsg("");
  };

  if (!root) {
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("gitTitle")}</span>
        </header>
        <EmptyState
          icon={FolderGit2}
          title={t("editorNoFolder")}
          action={{
            label: t("explorerOpenFolder"),
            onClick: () => void pickWorkspaceFolder(),
          }}
        />
      </div>
    );
  }

  if (notRepo) {
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("gitTitle")}</span>
        </header>
        <EmptyState
          icon={GitBranch}
          title={t("gitNotRepo")}
          text={t("gitNotRepoHint")}
          action={{ label: "git init", onClick: () => void run(["init"]) }}
        />
      </div>
    );
  }

  const totalChanges = staged.length + unstaged.length + untracked.length;

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <div className="min-w-0 flex-1">
          <GitBranches root={root} current={branch} onChanged={() => void refresh()} />
        </div>
        {hasRemote && (
          <>
            <button
              className="icon-btn"
              title={`${t("gitPull")}${behind ? ` · ${t("gitBehind", { n: String(behind) })}` : ""}`}
              onClick={() => void run(["pull", "--ff-only"])}
              disabled={busy}
            >
              <span className="relative">
                <ArrowDownToLine size={14} />
                {behind > 0 && <Dot />}
              </span>
            </button>
            <button
              className="icon-btn"
              title={`${t("gitPush")}${ahead ? ` · ${t("gitAhead", { n: String(ahead) })}` : ""}`}
              onClick={() => void run(["push"])}
              disabled={busy}
            >
              <span className="relative">
                <ArrowUpFromLine size={14} />
                {ahead > 0 && <Dot />}
              </span>
            </button>
            <button
              className="icon-btn"
              title={t("gitFetch")}
              onClick={() => void run(["fetch", "--all"])}
              disabled={busy}
            >
              <RefreshCcwDot size={14} />
            </button>
          </>
        )}
        {!hasRemote && (
          <span
            className="shrink-0 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]"
            title={t("gitNoRemote")}
          >
            —
          </span>
        )}
        <button className="icon-btn" title={t("refresh")} onClick={() => void refresh()}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {error && (
          <div className="alert my-2 text-[length:var(--fs-xs)]">{error}</div>
        )}

        {state.operation && (
          <OperationBanner
            state={state}
            onContinue={async () => {
              if (state.operation === "merge") {
                // A merge has no --continue; committing the resolved index is
                // what finishes it.
                await run(["commit", "--no-edit"]);
              } else if (state.operation) {
                const r = await continueOp(root, state.operation);
                if (!r.ok) setError(r.stderr.trim().slice(0, 300));
                await refresh();
              }
            }}
            onAbort={async () => {
              if (state.operation) await abort(root, state.operation);
              await refresh();
              refreshExplorer();
            }}
            onOpen={(p) => openTab({ path: `${root}/${p}`, name: p.split("/").pop() || p, kind: "file" })}
          />
        )}

        {!loaded ? (
          <ListSkeleton rows={6} />
        ) : (
          <>
        <Group title={t("gitStaged")} count={staged.length}>
          {staged.map((e) => (
            <div key={e.path}>
              <Row
                path={e.path}
                code={e.code}
                onClick={() => setExpanded((p) => (p === `s:${e.path}` ? null : `s:${e.path}`))}
                actionTitle={t("gitUnstage")}
                onAction={() => void run(["reset", "-q", "HEAD", "--", e.path])}
                actionIcon={<Minus size={12} />}
                onOpenDiff={() => showDiff(e.path, true)}
              />
              {expanded === `s:${e.path}` && root && (
                <HunkList root={root} path={e.path} staged onChanged={() => void refresh()} />
              )}
            </div>
          ))}
        </Group>

        <Group title={t("gitChanges")} count={unstaged.length}>
          {unstaged.map((e) => (
            <div key={e.path}>
              <Row
                path={e.path}
                code={e.code}
                onClick={() => setExpanded((p) => (p === `u:${e.path}` ? null : `u:${e.path}`))}
                actionTitle={t("gitStage")}
                onAction={() => void run(["add", "--", e.path])}
                actionIcon={<Plus size={12} />}
                onOpenDiff={() => showDiff(e.path, false)}
              />
              {expanded === `u:${e.path}` && root && (
                <HunkList root={root} path={e.path} staged={false} onChanged={() => void refresh()} />
              )}
            </div>
          ))}
        </Group>

        <Group title={t("gitUntracked")} count={untracked.length}>
          {untracked.map((p) => (
            <Row
              key={p}
              path={p}
              icon={<FileQuestion size={13} className="shrink-0 text-[var(--color-text-mute)]" />}
              onClick={() =>
                openTab({ path: `${root}/${p}`, name: p.split("/").pop() || p, kind: "file" })
              }
              actionTitle={t("gitStage")}
              onAction={() => void run(["add", "--", p])}
              actionIcon={<Plus size={12} />}
            />
          ))}
        </Group>

        {totalChanges === 0 && (
          <p className="px-2 py-8 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
            {t("gitClean")}
            <br />
            <span className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
              {t("gitCleanHint")}
            </span>
          </p>
        )}

        {log.length > 0 && (
          <>
            <div className="section-label flex items-center gap-1.5">
              <History size={11} /> {t("gitHistory")}
            </div>
            {log.map((l, i) => (
              <div
                key={i}
                title={l}
                className="truncate px-2 py-0.5 font-mono text-[length:var(--fs-xs)] text-[var(--color-text-dim)]"
              >
                {l}
              </div>
            ))}
          </>
        )}
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--color-border)] p-2">
        {unstaged.length + untracked.length > 0 && (
          <button className="btn btn-secondary btn-sm w-full" onClick={() => void run(["add", "-A"])}>
            {t("gitStageAll")}
          </button>
        )}
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
          placeholder={t("gitCommitPlaceholder")}
          className="input min-h-[52px] text-[length:var(--fs-base)]"
        />
        {signing?.enabled && (
          <p className="flex items-center gap-1 px-0.5 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
            <ShieldCheck size={11} className="text-[var(--color-accent)]" />
            {t("gitWillSign").replace("{fmt}", signing.format)}
          </p>
        )}
        <button
          className="btn btn-primary w-full"
          onClick={() => void commit()}
          disabled={!msg.trim() || staged.length === 0 || busy}
        >
          <GitCommit size={15} />
          {t("gitCommit")} {staged.length > 0 && `(${staged.length})`}
        </button>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent-strong)]" />
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-1">
      <div className="section-label">
        {title} · {count}
      </div>
      {children}
    </div>
  );
}

const CODE_TONE: Record<string, string> = {
  M: "text-[var(--color-modified)]",
  A: "text-[var(--color-added)]",
  D: "text-[var(--color-removed)]",
  R: "text-[var(--color-info)]",
};

function Row({
  path,
  code,
  icon,
  onClick,
  onAction,
  actionTitle,
  actionIcon,
  onOpenDiff,
}: {
  path: string;
  code?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  onAction: () => void;
  actionTitle: string;
  actionIcon: React.ReactNode;
  /** Open the full side-by-side diff, when the row supports hunks (the inline
   *  click toggles hunks instead). */
  onOpenDiff?: () => void;
}) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return (
    <div className="group/git relative flex items-center">
      <button className="row min-w-0 flex-1 pr-14" onClick={onClick} title={path}>
        {icon}
        <span className="truncate">{path.split("/").pop()}</span>
        {dir && (
          <span className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
            {dir}
          </span>
        )}
      </button>
      <span className="absolute right-1 flex items-center gap-0.5">
        <span className="flex opacity-0 transition-opacity group-hover/git:opacity-100">
          {onOpenDiff && (
            <button
              className="icon-btn h-6 w-6 bg-[var(--color-surface)]"
              title="diff"
              onClick={onOpenDiff}
            >
              <GitCompare size={12} />
            </button>
          )}
          <button
            className="icon-btn h-6 w-6 bg-[var(--color-surface)]"
            title={actionTitle}
            onClick={onAction}
          >
            {actionIcon}
          </button>
        </span>
        {code && (
          <span
            className={cn(
              "w-3 shrink-0 text-center font-mono text-[length:var(--fs-xs)] font-bold",
              CODE_TONE[code] ?? "text-[var(--color-text-dim)]",
            )}
          >
            {code}
          </span>
        )}
      </span>
    </div>
  );
}


/** A repository stuck mid-operation, made into an explanation and two buttons.
 *
 *  A conflicted merge or rebase is the moment people reach for the terminal
 *  because the GUI went quiet. It should not: the state is knowable, the
 *  conflicted files are listable, and the only two moves — resolve then
 *  continue, or abort — are the ones offered here.
 */
function OperationBanner({
  state,
  onContinue,
  onAbort,
  onOpen,
}: {
  state: RepoState;
  onContinue: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
  onOpen: (path: string) => void;
}) {
  const t = useT();
  const label =
    state.operation === "merge"
      ? t("gitOpMerge")
      : state.operation === "rebase"
        ? t("gitOpRebase")
        : t("gitOpCherry");
  const clean = state.conflicts.length === 0;
  return (
    <div className="my-2 rounded-[var(--r-md)] border border-[var(--color-warning,var(--color-border))] bg-[var(--color-surface-2)] p-2">
      <div className="mb-1 text-[length:var(--fs-xs)] font-medium">
        {label}{" "}
        {clean ? (
          <span className="text-[var(--color-ok,var(--color-accent))]">{t("gitOpReady")}</span>
        ) : (
          <span className="text-[var(--color-danger)]">
            {t("gitOpConflicts").replace("{n}", String(state.conflicts.length))}
          </span>
        )}
      </div>
      {state.conflicts.map((p) => (
        <button
          key={p}
          className="row w-full text-[length:var(--fs-xs)] text-[var(--color-danger)]"
          onClick={() => onOpen(p)}
          title={t("gitOpenConflict")}
        >
          <span className="truncate">{p}</span>
        </button>
      ))}
      <div className="mt-1.5 flex gap-1.5">
        <button
          className="btn btn-secondary btn-sm flex-1"
          disabled={!clean}
          onClick={() => void onContinue()}
          title={clean ? undefined : t("gitResolveFirst")}
        >
          {t("gitContinue")}
        </button>
        <button className="btn btn-ghost btn-sm flex-1" onClick={() => void onAbort()}>
          {t("gitAbort")}
        </button>
      </div>
    </div>
  );
}