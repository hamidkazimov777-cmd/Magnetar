import { describe, expect, it, vi } from "vitest";
import { BackgroundQueue } from "./backgroundQueue";

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("bounding background work", () => {
  it("runs no more than the concurrency at once", async () => {
    const q = new BackgroundQueue(2);
    const gates = [defer(), defer(), defer(), defer()];
    let running = 0;
    let peak = 0;
    gates.forEach((g, i) =>
      q.add(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }, "normal", `j${i}`),
    );

    // Two started, two waiting.
    await Promise.resolve();
    expect(peak).toBe(2);

    gates.forEach((g) => g.resolve());
    await vi.waitFor(() => expect(q.size).toBe(0));
    // The ceiling held the whole way through.
    expect(peak).toBe(2);
  });

  it("runs higher priority first", async () => {
    const q = new BackgroundQueue(1);
    const order: string[] = [];
    const first = defer();
    // Occupy the single slot so the rest queue behind it.
    q.add(async () => {
      order.push("blocker");
      await first.promise;
    }, "normal", "blocker");
    q.add(async () => void order.push("low"), "low", "low");
    q.add(async () => void order.push("high"), "high", "high");
    q.add(async () => void order.push("normal"), "normal", "normal");

    first.resolve();
    await vi.waitFor(() => expect(q.size).toBe(0));
    expect(order).toEqual(["blocker", "high", "normal", "low"]);
  });

  it("drops a duplicate key that is still pending", async () => {
    const q = new BackgroundQueue(1);
    const gate = defer();
    let ran = 0;
    q.add(async () => {
      ran++;
      await gate.promise;
    }, "normal", "same");
    // Same key, still in flight: dropped.
    q.add(async () => void ran++, "normal", "same");
    gate.resolve();
    await vi.waitFor(() => expect(q.size).toBe(0));
    expect(ran).toBe(1);
  });

  it("keeps turning when a job throws", async () => {
    const q = new BackgroundQueue(1);
    const done: string[] = [];
    q.add(async () => {
      throw new Error("boom");
    }, "normal", "bad");
    q.add(async () => void done.push("after"), "normal", "good");
    await vi.waitFor(() => expect(q.size).toBe(0));
    expect(done).toEqual(["after"]);
  });
});
