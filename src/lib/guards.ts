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
  /** Signature → how many times it has been seen. */
  seen: Map<string, number>;
  consecutiveFailures: number;
}

export function newLoopWatch(): LoopWatch {
  return { seen: new Map(), consecutiveFailures: 0 };
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

/** Record a call and report why the run should stop, if it should.
 *  Returns an explanation for the model, or null to carry on. */
export function checkLoop(
  watch: LoopWatch,
  name: string,
  args: ToolArgs,
  lastResultFailed: boolean,
): string | null {
  watch.consecutiveFailures = lastResultFailed ? watch.consecutiveFailures + 1 : 0;

  if (watch.consecutiveFailures >= FAILURE_LIMIT)
    return `${FAILURE_LIMIT} tool calls in a row failed. Stop and tell the user what is blocking you instead of trying again.`;

  const sig = callSignature(name, args);
  const count = (watch.seen.get(sig) ?? 0) + 1;
  watch.seen.set(sig, count);

  if (count > REPEAT_LIMIT)
    return `You have run essentially the same call ${count} times ("${sig}") without making progress. Stop, summarise what you found and what is blocking you, and ask the user how to proceed.`;

  return null;
}
