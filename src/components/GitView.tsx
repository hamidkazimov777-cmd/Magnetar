import { useCallback, useEffect, useState } from "react";
import {
  GitBranch,
  Plus,
  Minus,
  RefreshCw,
  Check,
  GitCommit,
  FileQuestion,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";

interface Entry {
  path: string;
  code: string;
}

export function GitView() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);

  const [branch, setBranch] = useState("");
  const [staged, setStaged] = useState<Entry[]>([]);
  const [unstaged, setUnstaged] = useState<Entry[]>([]);
  const [untracked, setUntracked] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [notRepo, setNotRepo] = useState(false);
  const [busy, setBusy] = useState(false);

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
      for (const line of st.stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("## ")) {
          br = line.slice(3).split("...")[0].split(" ")[0];
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
      setStaged(s);
      setUnstaged(u);
      setUntracked(un);
      const lg = await api.gitExec(root, ["log", "--oneline", "-10"]);
      setLog(lg.stdout.split("\n").filter(Boolean));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [root]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (args: string[]) => {
    if (!root) return;
    await api.gitExec(root, args);
    await refresh();
  };

  const showDiff = async (path: string, staged: boolean) => {
    if (!root) return;
    const args = staged
      ? ["diff", "--staged", "--", path]
      : ["diff", "--", path];
    const res = await api.gitExec(root, args);
    setDiff({ path, text: res.stdout || "(no diff)" });
  };

  const commit = async () => {
    if (!msg.trim() || staged.length === 0) return;
    await run(["commit", "-m", msg.trim()]);
    setMsg("");
    setDiff(null);
  };

  if (!root) {
    return (
      <div className="grid h-full flex-1 place-items-center text-sm text-[var(--color-text-dim)]">
        {t("editorNoFolder")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1">
      {/* Left: status + commit */}
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--color-border)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-sm">
            <GitBranch size={15} className="text-[var(--color-accent)]" />
            <span className="font-medium">{branch || "—"}</span>
          </div>
          <button
            onClick={refresh}
            className="rounded-lg p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
          >
            <RefreshCw size={14} className={cn(busy && "animate-spin")} />
          </button>
        </div>

        {notRepo ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-[var(--color-text-dim)]">{t("gitNotRepo")}</p>
            <button
              onClick={() => run(["init"])}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-accent-fg)]"
            >
              git init
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 text-sm">
            <Group title={t("gitStaged")} count={staged.length}>
              {staged.map((e) => (
                <Row
                  key={e.path}
                  path={e.path}
                  code={e.code}
                  onClick={() => showDiff(e.path, true)}
                  action={
                    <IconBtn title={t("gitUnstage")} onClick={() => run(["reset", "-q", "HEAD", "--", e.path])}>
                      <Minus size={13} />
                    </IconBtn>
                  }
                />
              ))}
            </Group>
            <Group title={t("gitChanges")} count={unstaged.length}>
              {unstaged.map((e) => (
                <Row
                  key={e.path}
                  path={e.path}
                  code={e.code}
                  onClick={() => showDiff(e.path, false)}
                  action={
                    <IconBtn title={t("gitStage")} onClick={() => run(["add", "--", e.path])}>
                      <Plus size={13} />
                    </IconBtn>
                  }
                />
              ))}
            </Group>
            <Group title={t("gitUntracked")} count={untracked.length}>
              {untracked.map((p) => (
                <Row
                  key={p}
                  path={p}
                  icon={<FileQuestion size={13} className="text-[var(--color-text-dim)]" />}
                  action={
                    <IconBtn title={t("gitStage")} onClick={() => run(["add", "--", p])}>
                      <Plus size={13} />
                    </IconBtn>
                  }
                />
              ))}
            </Group>

            {staged.length + unstaged.length + untracked.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-[var(--color-text-dim)]">
                {t("gitClean")}
              </p>
            )}
          </div>
        )}

        {!notRepo && (
          <div className="space-y-2 border-t border-[var(--color-border)] p-3">
            {unstaged.length + untracked.length > 0 && (
              <button
                onClick={() => run(["add", "-A"])}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]"
              >
                {t("gitStageAll")}
              </button>
            )}
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              rows={2}
              placeholder={t("gitCommitPlaceholder")}
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={commit}
              disabled={!msg.trim() || staged.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-[var(--color-accent-fg)] disabled:opacity-40"
            >
              <GitCommit size={15} />
              {t("gitCommit")} ({staged.length})
            </button>
          </div>
        )}
      </div>

      {/* Right: diff + log */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {diff ? (
            <>
              <div className="mb-2 font-mono text-xs text-[var(--color-text-dim)]">
                {diff.path}
              </div>
              <DiffPre text={diff.text} />
            </>
          ) : (
            <div className="grid h-full place-items-center text-sm text-[var(--color-text-dim)]">
              {t("gitPickFile")}
            </div>
          )}
        </div>
        {log.length > 0 && (
          <div className="max-h-40 overflow-y-auto border-t border-[var(--color-border)] p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
              <Check size={12} /> {t("gitHistory")}
            </div>
            {log.map((l, i) => (
              <div key={i} className="truncate py-0.5 font-mono text-xs text-[var(--color-text)]">
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
    <div className="mb-2">
      <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
        {title} · {count}
      </div>
      {children}
    </div>
  );
}

function Row({
  path,
  code,
  icon,
  action,
  onClick,
}: {
  path: string;
  code?: string;
  icon?: React.ReactNode;
  action: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--color-surface-2)]">
      {icon}
      {code && (
        <span className="w-3 shrink-0 text-center font-mono text-xs text-[var(--color-accent-strong)]">
          {code}
        </span>
      )}
      <button
        onClick={onClick}
        className="min-w-0 flex-1 truncate text-left text-[13px] text-[var(--color-text)]"
        title={path}
      >
        {path.split("/").pop()}
        <span className="ml-1 text-[var(--color-text-dim)]">
          {path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}
        </span>
      </button>
      <span className="opacity-0 transition group-hover:opacity-100">{action}</span>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded text-[var(--color-text-dim)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
    >
      {children}
    </button>
  );
}

function DiffPre({ text }: { text: string }) {
  return (
    <pre className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed">
      {text.split("\n").map((l, i) => {
        const c = l[0];
        const cls =
          l.startsWith("+++") || l.startsWith("---")
            ? "text-[var(--color-text-dim)]"
            : c === "+"
              ? "text-emerald-300"
              : c === "-"
                ? "text-red-300"
                : l.startsWith("@@")
                  ? "text-[var(--color-accent-strong)]"
                  : "text-[var(--color-text-dim)]";
        return (
          <div key={i} className={cls}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}
