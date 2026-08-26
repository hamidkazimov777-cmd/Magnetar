/** Structured, redacted error reporting shared by UI and async domain code.
 *
 * Error strings can contain provider responses, authorization headers or file
 * contents. Keep the user-facing message useful, but never echo likely secret
 * values into logs or traces.
 */

export interface AppError {
  context: string;
  message: string;
  retryable: boolean;
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: AppError, attempt: number) => boolean;
}

const SECRET_VALUE =
  /(api[-_ ]?key|authorization|bearer|basic|token|secret|password|client[-_ ]?id|rq[-_ ]?uid)(\s*[:=]\s*|\s+)([^\s,;}\]]+)/gi;

export function redactSecrets(value: string): string {
  return value
    .replace(SECRET_VALUE, "$1: [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "[REDACTED]");
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export function toAppError(error: unknown, context: string): AppError {
  const message = redactSecrets(rawMessage(error)).trim().slice(0, 2000) || "Unknown error";
  const lower = message.toLowerCase();
  return {
    context,
    message,
    retryable:
      /timeout|timed out|temporar|rate limit|429|network|fetch|connection|busy/i.test(lower),
  };
}

/** Report once to the supplied sink and return the safe error for UI/state. */
export function reportError(
  error: unknown,
  context: string,
  sink: (message: string, error?: AppError) => void = (message, detail) =>
    console.error(message, detail),
): AppError {
  const normalized = toAppError(error, context);
  sink(`[Magnetar:${context}] ${normalized.message}`, normalized);
  return normalized;
}

/** Fire-and-forget helper for background work that must remain visible. */
export function reportPromise<T>(
  promise: Promise<T>,
  context: string,
  onError?: (error: AppError) => void,
): Promise<T | undefined> {
  return promise.catch((error: unknown) => {
    const normalized = reportError(error, context);
    onError?.(normalized);
    return undefined;
  });
}

/** Retry transient async work without retrying non-idempotent failures by default. */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 250);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error("cancelled");
    try {
      return await operation(attempt);
    } catch (error) {
      const normalized = toAppError(error, "retry");
      const retry =
        attempt + 1 < attempts &&
        normalized.retryable &&
        (options.shouldRetry?.(normalized, attempt) ?? true);
      if (!retry) throw error;
      await sleep(delayMs * 2 ** attempt);
    }
  }

  throw new Error("retry exhausted");
}
