import type { ToolArgs } from "./agent";

/* ==========================================================================
   AGENT GUARDRAILS

   Written after a real incident: asked whether a bot was ready to run, the
   agent spent a long run killing processes and re-reading files, overwrote the
   project's .env — replacing a live Telegram token with the placeholder from
   .env.example — and only stopped when the provider ran out of credit.

   Two things were missing. Files that hold secrets were treated like any other
   source file, and nothing noticed that the same commands were being repeated
   with no progress. Both are cheap to detect and expensive to miss.
   ========================================================================== */

/** Files whose contents are credentials, not code. Overwriting one destroys
 *  something the user cannot regenerate from the repository. */
const SECRET_FILE =
  /(^|[/\\])(\.env(\.[\w-]+)?|secrets?\.(json|ya?ml|toml)|credentials(\.\w+)?|id_[a-z0-9_]+|.*\.(pem|p12|pfx|key|keystore|jks))$/i;

/** `.env.example` and friends are templates — safe, and often what the agent
 *  legitimately wants to read. */
const SECRET_EXCEPTION = /\.(example|sample|template|dist)$/i;

export function isSecretPath(path: unknown): boolean {
  if (typeof path !== "string" || !path) return false;
  if (SECRET_EXCEPTION.test(path)) return false;
  return SECRET_FILE.test(path);
}

/** Shell commands that destroy state rather than inspect it. Killing processes
 *  and removing files are not "ordinary steps" the agent may take unattended. */
const DANGEROUS_SHELL =
  /\b(rm\s+-[rf]|rmdir|pkill|kill\s+-9|killall|shutdown|reboot|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+(reset\s+--hard|clean\s+-[fdx]+|push\s+--force)|:\s*\(\)\s*\{)/i;

/** True when a call must be confirmed regardless of the user's auto-apply
 *  preference. Auto-apply is about routine edits; this is about damage. */
export function alwaysConfirm(name: string, args: ToolArgs): boolean {
  if (name === "write_file" || name === "edit_file") {
    return isSecretPath(args.path);
  }
  if (name === "run_bash") {
    const cmd = typeof args.command === "string" ? args.command : "";
    return DANGEROUS_SHELL.test(cmd);
  }
  if (name === "delete_file") return true;
  // Creating a project folder is not destructive, but it puts a directory on
  // the user's disk in a place they did not name. One dialog, once.
  if (name === "new_project") return true;
  return false;
}

/* --------------------------------------------------------------------------
   Loop detection
   -------------------------------------------------------------------------- */

/** How many times the same call may repeat before the run is considered stuck. */
const REPEAT_LIMIT = 3;
/** How many calls in a row may fail before we stop burning tokens. */
const FAILURE_LIMIT = 5;

export interface LoopWatch {
  /** Signature → how many times it repeated AND the last result seen for it.
   *  Progress is judged by the result changing, not by the call being reissued:
   *  polling a build with `sleep N && tail log` reruns the same command on
   *  purpose, and as long as the log grows the result differs and it is not a
   *  loop. Only the same call returning the same result over and over is stuck. */
  seen: Map<string, { count: number; lastResult: string }>;
  consecutiveFailures: number;
}

export function newLoopWatch(): LoopWatch {
  return { seen: new Map(), consecutiveFailures: 0 };
}

/** A compact digest of a result for equality comparison. The tail is kept
 *  because a growing log changes at the end; numbers are NOT normalised here (a
 *  changing byte count or timestamp is exactly the progress we want to see). */
function resultDigest(result: string): string {
  return result.replace(/\s+/g, " ").trim().slice(-400);
}

/** Normalise a call so that trivially different repeats still match: the same
 *  command with a different sleep, or the same file read twice. */
export function callSignature(name: string, args: ToolArgs): string {
  const norm = (s: string) =>
    s
      .replace(/\s+/g, " ")
      .replace(/\bsleep\s+\d+/gi, "sleep N")
      .replace(/\b\d{2,}\b/g, "N")
      .trim()
      .slice(0, 200);
  if (name === "run_bash")
    return `run_bash:${norm(typeof args.command === "string" ? args.command : "")}`;
  const path = typeof args.path === "string" ? args.path : "";
  return `${name}:${path}`;
}

/** Record a completed call and report why the run should stop, if it should.
 *  Called AFTER the tool runs, so it can judge progress by the result: a repeat
 *  that returns something new (a growing log, a different error) is work, not a
 *  loop. Returns an explanation for the model, or null to carry on. */
export function checkLoop(
  watch: LoopWatch,
  name: string,
  args: ToolArgs,
  result: string,
  lastResultFailed: boolean,
): string | null {
  watch.consecutiveFailures = lastResultFailed ? watch.consecutiveFailures + 1 : 0;

  if (watch.consecutiveFailures >= FAILURE_LIMIT)
    return `${FAILURE_LIMIT} tool calls in a row failed. Stop and tell the user what is blocking you instead of trying again.`;

  const sig = callSignature(name, args);
  const digest = resultDigest(result);
  const prev = watch.seen.get(sig);

  if (prev && prev.lastResult === digest) {
    // Same call, same result — no progress. This is the real loop.
    prev.count += 1;
    if (prev.count > REPEAT_LIMIT)
      return `You have run essentially the same call ${prev.count} times ("${sig}") and got the same result each time — no progress. Stop, summarise what you found and what is blocking you, and ask the user how to proceed.`;
  } else {
    // First time, or the result changed: reset the counter for this signature.
    watch.seen.set(sig, { count: 1, lastResult: digest });
  }

  return null;
}
