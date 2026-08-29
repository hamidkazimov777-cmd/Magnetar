/* ==========================================================================
   A BOUNDED QUEUE FOR BACKGROUND WORK

   Memory extraction, rolling summaries and fact verification all run in the
   background off the same cheap model, triggered from several places at once —
   a long agent run can kick off a summary and a brain extraction on every
   turn. Fired as bare promises, they pile up: a dozen model calls in flight,
   racing each other for the same rate limit, none of them urgent.

   This runs them a few at a time, highest priority first. It is not a job
   system — no persistence, no retries here (callers keep their own) — just a
   ceiling on how much background work happens at once, so it never competes
   with the thing the user is actually waiting for.
   ========================================================================== */

export type Priority = "high" | "normal" | "low";

interface Job {
  run: () => Promise<unknown>;
  priority: Priority;
  /** A key so the same job queued twice while still pending runs once. */
  key?: string;
}

const ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export class BackgroundQueue {
  private queue: Job[] = [];
  private active = 0;
  private pendingKeys = new Set<string>();

  constructor(private readonly concurrency = 2) {}

  /** Queue a job. A job with a key already waiting is dropped rather than
   *  queued twice — re-summarising the same conversation three times because
   *  three turns landed quickly is wasted model calls. */
  add(run: () => Promise<unknown>, priority: Priority = "normal", key?: string): void {
    if (key && this.pendingKeys.has(key)) return;
    if (key) this.pendingKeys.add(key);
    this.queue.push({ run, priority, key });
    // Stable sort by priority: within a priority, first-queued runs first.
    this.queue.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void Promise.resolve()
        .then(job.run)
        .catch(() => {
          // A background job's own failure is its own to report; the queue only
          // owns keeping the machine turning.
        })
        .finally(() => {
          this.active--;
          if (job.key) this.pendingKeys.delete(job.key);
          this.pump();
        });
    }
  }

  /** For tests and shutdown: how much is outstanding. */
  get size(): number {
    return this.queue.length + this.active;
  }
}

/** The one queue the app's background memory work shares, so all of it together
 *  is bounded rather than each caller being bounded alone. */
export const backgroundQueue = new BackgroundQueue(2);
