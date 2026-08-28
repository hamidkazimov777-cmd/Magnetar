import { api } from "./api";

/* ==========================================================================
   GIT, AS OPERATIONS RATHER THAN COMMAND STRINGS

   The panel used to build `git` argument arrays inline and read the raw output
   back where it was needed. That is fine for `status`; it falls apart for the
   operations Step 6 adds — a branch list has to distinguish the current branch,
   a stash has an index the user never sees, a merge can leave the tree in a
   conflict state that the next action depends on knowing about.

   So parsing lives here, as pure functions with the raw output as input, and
   the side-effecting calls are thin wrappers over them. The parsers are the
   part that silently returns the wrong branch or misses a conflicted file, so
   they are the part with tests.

   Every call goes through `api.gitExec`, which since Step 2 resolves its
   working directory through path containment and records the invocation. This
   module adds no way around that.
   ========================================================================== */

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

async function git(root: string, args: string[]): Promise<GitResult> {
  const r = await api.gitExec(root, args);
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

/** The message a failed git command should show — its own stderr, trimmed,
 *  never a generic "command failed". Git's diagnostics are usually the most
 *  useful thing on screen. */
export function gitError(r: GitResult): string {
  return (r.stderr.trim() || r.stdout.trim() || `git exited ${r.code}`).slice(0, 400);
}

/* ---- Branches ---------------------------------------------------------- */

export interface Branch {
  name: string;
  current: boolean;
  /** For a local branch, its upstream if it has one. */
  upstream?: string;
  ahead: number;
  behind: number;
  /** True for `remotes/origin/…` entries. */
  remote: boolean;
}

/** Parse `git branch --all -vv --format=…` output.
 *
 *  The porcelain `--format` is used rather than the human `branch -a` because
 *  the latter marks the current branch with a `*` in a column that a branch
 *  named `* something` (yes, that is legal) would forge.
 */
export function parseBranches(stdout: string): Branch[] {
  const out: Branch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // Format: "<head>\x00<refname>\x00<upstream>\x00<track>"
    const [head, refname, upstream, track] = line.split("\x00");
    if (!refname) continue;
    const remote = refname.startsWith("refs/remotes/");
    // A remote's HEAD pointer (origin/HEAD -> origin/main) is noise in a list.
    if (remote && / -> /.test(track ?? "")) continue;
    const name = refname
      .replace(/^refs\/heads\//, "")
      .replace(/^refs\/remotes\//, "");
    out.push({
      name,
      current: head === "*",
      upstream: upstream || undefined,
      ahead: Number(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0),
      remote,
    });
  }
  return out;
}

export async function listBranches(root: string): Promise<Branch[]> {
  const r = await git(root, [
    "branch",
    "--all",
    "--format=%(HEAD)%00%(refname)%00%(upstream:short)%00%(upstream:track)",
  ]);
  return r.ok ? parseBranches(r.stdout) : [];
}

export const checkout = (root: string, branch: string) => git(root, ["checkout", branch]);

export const createBranch = (root: string, name: string, from?: string) =>
  git(root, ["checkout", "-b", name, ...(from ? [from] : [])]);

export const deleteBranch = (root: string, name: string, force = false) =>
  git(root, ["branch", force ? "-D" : "-d", name]);

export const merge = (root: string, branch: string) => git(root, ["merge", "--no-edit", branch]);

export const rebase = (root: string, onto: string) => git(root, ["rebase", onto]);

export const cherryPick = (root: string, sha: string) => git(root, ["cherry-pick", sha]);

/** Abort whichever operation is in progress. `--quit` is not offered: leaving a
 *  half-finished rebase on disk is a foot-gun, and "abort" is the answer people
 *  actually want when they reach for the escape hatch. */
export const abort = (root: string, kind: "merge" | "rebase" | "cherry-pick") =>
  git(root, [kind, "--abort"]);

export const continueOp = (root: string, kind: "rebase" | "cherry-pick") =>
  git(root, [kind, "--continue"]);

/* ---- Stash ------------------------------------------------------------- */

export interface Stash {
  index: number;
  /** "WIP on main: 1a2b3c message" — shown as the user wrote it. */
  message: string;
  branch: string;
}

export function parseStashes(stdout: string): Stash[] {
  const out: Stash[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // "stash@{0}: On main: my message" or "WIP on main: …"
    const m = /^stash@\{(\d+)\}:\s*(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[2];
    const branch = /(?:WIP on|On)\s+([^:]+):/.exec(rest)?.[1]?.trim() ?? "";
    out.push({ index: Number(m[1]), message: rest, branch });
  }
  return out;
}

export async function listStashes(root: string): Promise<Stash[]> {
  const r = await git(root, ["stash", "list"]);
  return r.ok ? parseStashes(r.stdout) : [];
}

export const stashPush = (root: string, message?: string) =>
  git(root, ["stash", "push", ...(message ? ["-m", message] : [])]);

/** Apply-and-drop is what people mean by "unstash"; keeping it after applying
 *  is a separate, rarer intent. */
export const stashPop = (root: string, index: number) =>
  git(root, ["stash", "pop", `stash@{${index}}`]);

export const stashDrop = (root: string, index: number) =>
  git(root, ["stash", "drop", `stash@{${index}}`]);

/* ---- State: is a merge/rebase in progress, and what is conflicted? ------ */

export interface RepoState {
  operation: "merge" | "rebase" | "cherry-pick" | null;
  conflicts: string[];
}

/** Files with an unmerged (conflicted) index entry.
 *
 *  Read from `status --porcelain=v2`, whose unmerged records begin with `u` and
 *  carry the path last. The v1 two-letter codes (`UU`, `AA`, `DD`) are
 *  ambiguous — `AA` is both "both added" and, in another column position,
 *  something else — so v2 is used for the one question that must be exact.
 */
export function parseConflicts(porcelainV2: string): string[] {
  const out: string[] = [];
  for (const line of porcelainV2.split("\n")) {
    if (!line.startsWith("u ")) continue;
    // "u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
    const path = line.split(" ").slice(10).join(" ");
    if (path) out.push(path);
  }
  return out;
}

export async function repoState(root: string): Promise<RepoState> {
  // The in-progress operation is read from the refs git leaves behind when it
  // stops — MERGE_HEAD, CHERRY_PICK_HEAD, REBASE_HEAD — rather than by poking
  // at .git on disk. rev-parse answers the same question without a filesystem
  // check, and REBASE_HEAD is present exactly when a rebase has stopped, which
  // is the only time this state matters (it stopped because of a conflict).
  const [status, mergeHead, rebaseHead, cherry] = await Promise.all([
    git(root, ["status", "--porcelain=v2"]),
    git(root, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]),
    git(root, ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"]),
    git(root, ["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]),
  ]);

  const has = (r: GitResult) => r.ok && r.stdout.trim().length > 0;
  const operation: RepoState["operation"] = has(rebaseHead)
    ? "rebase"
    : has(cherry)
      ? "cherry-pick"
      : has(mergeHead)
        ? "merge"
        : null;

  return { operation, conflicts: parseConflicts(status.stdout) };
}

/* ---- Blame ------------------------------------------------------------- */

export interface BlameLine {
  sha: string;
  author: string;
  /** Unix seconds. */
  time: number;
  line: number;
  content: string;
}

/** Parse `git blame --line-porcelain`.
 *
 *  Porcelain because the default format truncates author names and dates to
 *  whatever fits a terminal, and this drives a gutter, not a terminal.
 */
export function parseBlame(stdout: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = stdout.split("\n");
  let sha = "";
  let author = "";
  let time = 0;
  let lineNo = 0;
  for (const line of lines) {
    const header = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(line);
    if (header) {
      sha = header[1];
      lineNo = Number(header[2]);
      continue;
    }
    if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("author-time ")) time = Number(line.slice(12));
    else if (line.startsWith("\t")) {
      out.push({ sha, author, time, line: lineNo, content: line.slice(1) });
    }
  }
  return out;
}

export async function blame(root: string, path: string): Promise<BlameLine[]> {
  const r = await git(root, ["blame", "--line-porcelain", "--", path]);
  return r.ok ? parseBlame(r.stdout) : [];
}

/* ---- File history ------------------------------------------------------ */

export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** Unix seconds. */
  time: number;
}

export function parseLog(stdout: string): Commit[] {
  const out: Commit[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // "<sha>\x00<short>\x00<subject>\x00<author>\x00<unixtime>"
    const [sha, shortSha, subject, author, time] = line.split("\x00");
    if (!sha) continue;
    out.push({ sha, shortSha, subject, author, time: Number(time) });
  }
  return out;
}

const LOG_FORMAT = "--format=%H%x00%h%x00%s%x00%an%x00%at";

export async function fileHistory(root: string, path: string, limit = 50): Promise<Commit[]> {
  const r = await git(root, ["log", LOG_FORMAT, `-${limit}`, "--", path]);
  return r.ok ? parseLog(r.stdout) : [];
}

export async function log(root: string, limit = 50): Promise<Commit[]> {
  const r = await git(root, ["log", LOG_FORMAT, `-${limit}`]);
  return r.ok ? parseLog(r.stdout) : [];
}

/* ---- Remotes ----------------------------------------------------------- */

export interface Remote {
  name: string;
  fetchUrl: string;
}

export function parseRemotes(stdout: string): Remote[] {
  const seen = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    // "origin\thttps://…(fetch)"
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (m && m[3] === "fetch") seen.set(m[1], m[2]);
  }
  return [...seen].map(([name, fetchUrl]) => ({ name, fetchUrl }));
}

export async function listRemotes(root: string): Promise<Remote[]> {
  const r = await git(root, ["remote", "-v"]);
  return r.ok ? parseRemotes(r.stdout) : [];
}

export const addRemote = (root: string, name: string, url: string) =>
  git(root, ["remote", "add", name, url]);

export const removeRemote = (root: string, name: string) =>
  git(root, ["remote", "remove", name]);

/* ---- Commit signing ---------------------------------------------------- */

export interface SigningStatus {
  /** Configured to sign commits (`commit.gpgsign true`). */
  enabled: boolean;
  /** The signing key or identity, if one is set. */
  key?: string;
  format: "openpgp" | "ssh" | "x509";
}

/** Read the signing configuration without attempting a signature.
 *
 *  Detecting whether signing *works* would mean making a test commit; reporting
 *  what is *configured* is honest and does not touch the repository. If it is
 *  on but misconfigured, the first real commit says so — and that error is
 *  git's, which is clearer than anything guessed here.
 */
export async function signingStatus(root: string): Promise<SigningStatus> {
  const [sign, key, format] = await Promise.all([
    git(root, ["config", "--get", "commit.gpgsign"]),
    git(root, ["config", "--get", "user.signingkey"]),
    git(root, ["config", "--get", "gpg.format"]),
  ]);
  const fmt = format.stdout.trim();
  return {
    enabled: sign.stdout.trim() === "true",
    key: key.stdout.trim() || undefined,
    format: fmt === "ssh" ? "ssh" : fmt === "x509" ? "x509" : "openpgp",
  };
}

export const commit = (root: string, message: string, sign?: boolean) =>
  git(root, ["commit", ...(sign ? ["-S"] : []), "-m", message]);
