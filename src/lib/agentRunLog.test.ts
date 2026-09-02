import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginRunLog } from "./agentRunLog";
import { db } from "./db";
import type { AgentHandlers } from "./agent";

vi.mock("./db", () => ({
  db: {
    saveAgentRun: vi.fn(() => Promise.resolve()),
    appendAgentEvent: vi.fn(() => Promise.resolve(0)),
  },
}));

const meta = {
  sessionId: "s1",
  projectId: "p1",
  connectionId: "c1",
  model: "m1",
};

const baseHandlers = (): AgentHandlers => ({
  confirm: () => Promise.resolve(true),
  onText: vi.fn(),
  onTool: vi.fn(),
  onUsage: vi.fn(),
});

describe("beginRunLog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a running row as soon as it begins", () => {
    beginRunLog(meta);
    expect(db.saveAgentRun).toHaveBeenCalledTimes(1);
    const row = vi.mocked(db.saveAgentRun).mock.calls[0][0];
    expect(row).toMatchObject({ sessionId: "s1", model: "m1", status: "running", steps: 0 });
  });

  it("logs tool_call and tool_result, and still forwards to the caller", () => {
    const log = beginRunLog(meta);
    const inner = baseHandlers();
    const h = log.wrap(inner);

    h.onTool!({ id: "t1", name: "read_file", args: { path: "a" }, status: "running" });
    h.onTool!({ id: "t1", name: "read_file", args: { path: "a" }, status: "done", result: "ok" });

    const kinds = vi.mocked(db.appendAgentEvent).mock.calls.map((c) => c[2]);
    expect(kinds).toEqual(["tool_call", "tool_result"]);
    expect(inner.onTool).toHaveBeenCalledTimes(2);
  });

  it("accumulates usage into steps and tokens, and logs a model_turn", () => {
    const log = beginRunLog(meta);
    const inner = baseHandlers();
    const h = log.wrap(inner);

    h.onUsage!({ inputTokens: 10, outputTokens: 5 });
    h.onUsage!({ inputTokens: 3, outputTokens: 2 });

    // Two model_turn events, and the run row saved again after each.
    const kinds = vi.mocked(db.appendAgentEvent).mock.calls.map((c) => c[2]);
    expect(kinds.filter((k) => k === "model_turn")).toHaveLength(2);
    const saves = vi.mocked(db.saveAgentRun).mock.calls;
    const lastSave = saves[saves.length - 1][0];
    expect(lastSave).toMatchObject({ steps: 2, tokensIn: 13, tokensOut: 7 });
    expect(inner.onUsage).toHaveBeenCalledTimes(2);
  });

  it("stops the run when the token budget is spent", () => {
    const log = beginRunLog({ ...meta, budgetTokens: 20 });
    const h = log.wrap(baseHandlers());

    expect(h.overBudget!()).toBeNull();
    h.onUsage!({ inputTokens: 15, outputTokens: 4 }); // 19 < 20, still fine
    expect(h.overBudget!()).toBeNull();
    h.onUsage!({ inputTokens: 2, outputTokens: 0 }); // 21 ≥ 20
    const reason = h.overBudget!();
    expect(reason).toMatch(/Token budget reached/);
    expect(log.budgetHit()).toBe(true);
  });

  it("does not enforce a budget when the ceiling is zero", () => {
    const log = beginRunLog({ ...meta, budgetTokens: 0 });
    const h = log.wrap(baseHandlers());
    h.onUsage!({ inputTokens: 999999, outputTokens: 999999 });
    expect(h.overBudget!()).toBeNull();
    expect(log.budgetHit()).toBe(false);
  });

  it("closes the run with its final status and an error event", async () => {
    const log = beginRunLog(meta);
    await log.finish("error", "boom");
    const saves = vi.mocked(db.saveAgentRun).mock.calls;
    const lastSave = saves[saves.length - 1][0];
    expect(lastSave).toMatchObject({ status: "error", error: "boom" });
    expect(lastSave.endedAt).not.toBeNull();
    const errEvent = vi.mocked(db.appendAgentEvent).mock.calls.find((c) => c[2] === "error");
    expect(errEvent).toBeTruthy();
  });
});
