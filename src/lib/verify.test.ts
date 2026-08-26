import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryFact, VerifySpec } from "./types";

vi.mock("./api", () => ({ api: { editorReadFile: vi.fn(), toolGrep: vi.fn() } }));
vi.mock("./problems", () => ({ discoverChecks: vi.fn(), runCheck: vi.fn() }));
vi.mock("./divergence", () => ({ queueDivergence: vi.fn() }));

const { api } = await import("./api");
const { discoverChecks, runCheck } = await import("./problems");
const { queueDivergence } = await import("./divergence");
const { verifyFact, verifyProjectFacts } = await import("./verify");
const { useStore } = await import("./store");

const readFile = vi.mocked(api.editorReadFile);
const toolGrep = vi.mocked(api.toolGrep);
const checks = vi.mocked(discoverChecks);
const run = vi.mocked(runCheck);
const queue = vi.mocked(queueDivergence);

const fact = (spec: VerifySpec | undefined, over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: "f1",
  projectId: "p1",
  kind: "stack",
  text: "Uses SQLite",
  origin: "extracted",
  originDetail: "Cargo.toml",
  verify: spec ? JSON.stringify(spec) : undefined,
  status: "unverified",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const grepSpec: VerifySpec = { kind: "grep", pattern: "rusqlite", file: "Cargo.toml" };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ facts: {}, decisions: {}, logMemory: vi.fn(), saveFacts: vi.fn() });
});

describe("verifying one fact by machine", () => {
  it("says nothing about a fact that carries no check", async () => {
    expect(await verifyFact("/repo", fact(undefined))).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("confirms a claim found in the file it named", async () => {
    readFile.mockResolvedValue('rusqlite = { version = "0.32" }');
    const res = await verifyFact("/repo", fact(grepSpec));
    expect(res!.outcome).toBe("verified");
    expect(res!.fact.status).toBe("verified");
    expect(res!.fact.checkedAt).toBeGreaterThan(0);
    expect(readFile).toHaveBeenCalledWith("/repo/Cargo.toml");
  });

  it("calls the evidence stale, not the claim false, when the file is gone", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));
    const res = await verifyFact("/repo", fact(grepSpec));
    expect(res!.outcome).toBe("stale");
    expect(toolGrep).not.toHaveBeenCalled();
  });

  it("searches the project before refuting a fact that named the wrong file", async () => {
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockResolvedValue(["src-tauri/Cargo.toml:12"] as never);
    const res = await verifyFact("/repo", fact(grepSpec));
    expect(res!.outcome).toBe("verified");
    expect(toolGrep).toHaveBeenCalledWith("rusqlite", "/repo");
  });

  it("refutes only after the file and the project search both come back empty", async () => {
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockResolvedValue([] as never);
    const res = await verifyFact("/repo", fact(grepSpec));
    expect(res!.outcome).toBe("refuted");
    expect(res!.fact.status).toBe("refuted");
  });

  it("stays silent when search is unavailable rather than guessing", async () => {
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockRejectedValue(new Error("index offline"));
    expect(await verifyFact("/repo", fact(grepSpec))).toBeNull();
  });

  it("treats a malformed pattern as our bug, not the project's", async () => {
    readFile.mockResolvedValue("anything");
    const bad: VerifySpec = { kind: "grep", pattern: "([unclosed", file: "Cargo.toml" };
    expect(await verifyFact("/repo", fact(bad))).toBeNull();
  });

  it("tries each alternative of a multi-candidate pattern", async () => {
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockResolvedValueOnce([] as never).mockResolvedValueOnce(["hit"] as never);
    const spec: VerifySpec = { kind: "grep", pattern: "rusqlite|sqlite3", file: "Cargo.toml" };
    const res = await verifyFact("/repo", fact(spec));
    expect(res!.outcome).toBe("verified");
    expect(toolGrep).toHaveBeenCalledTimes(2);
  });

  it("holds a fact while the project's own check passes and drops it when it fails", async () => {
    const spec: VerifySpec = { kind: "check", checkId: "cargo-check" };
    checks.mockResolvedValue([{ id: "cargo-check", label: "cargo", command: "cargo check" }]);

    run.mockResolvedValue({ checkId: "cargo-check", status: "ok", problems: [] });
    expect((await verifyFact("/repo", fact(spec)))!.outcome).toBe("verified");

    run.mockResolvedValue({ checkId: "cargo-check", status: "failed", problems: [] });
    expect((await verifyFact("/repo", fact(spec)))!.outcome).toBe("refuted");
  });

  it("goes stale on a check the project no longer defines, and silent on one that could not run", async () => {
    const spec: VerifySpec = { kind: "check", checkId: "cargo-check" };
    checks.mockResolvedValue([]);
    expect((await verifyFact("/repo", fact(spec)))!.outcome).toBe("stale");

    checks.mockResolvedValue([{ id: "cargo-check", label: "cargo", command: "cargo check" }]);
    run.mockResolvedValue({ checkId: "cargo-check", status: "error", problems: [] });
    expect(await verifyFact("/repo", fact(spec))).toBeNull();
  });
});

describe("verifying a project's facts", () => {
  it("does nothing, and writes nothing, when no fact carries a check", async () => {
    const saveFacts = vi.fn();
    useStore.setState({ saveFacts, facts: { p1: [fact(undefined)] } });
    expect(await verifyProjectFacts("/repo", "p1")).toEqual({
      verified: 0,
      refuted: 0,
      stale: 0,
    });
    expect(saveFacts).not.toHaveBeenCalled();
  });

  it("leaves the expensive project checks alone unless asked for them", async () => {
    useStore.setState({ facts: { p1: [fact({ kind: "check", checkId: "cargo-check" })] } });
    await verifyProjectFacts("/repo", "p1");
    expect(checks).not.toHaveBeenCalled();

    checks.mockResolvedValue([]);
    await verifyProjectFacts("/repo", "p1", { includeChecks: true });
    expect(checks).toHaveBeenCalled();
  });

  it("tallies outcomes and writes back only the facts that changed", async () => {
    const saveFacts = vi.fn();
    useStore.setState({
      saveFacts,
      facts: {
        p1: [
          fact(grepSpec, { id: "a", text: "Uses SQLite" }),
          fact(grepSpec, { id: "b", text: "Uses SQLite", status: "verified", checkedAt: 5 }),
        ],
      },
    });
    readFile.mockResolvedValue("rusqlite");
    const tally = await verifyProjectFacts("/repo", "p1");
    expect(tally).toEqual({ verified: 2, refuted: 0, stale: 0 });
    expect(saveFacts).toHaveBeenCalledTimes(1);
    expect(saveFacts.mock.calls[0][0].map((f: MemoryFact) => f.id)).toEqual(["a"]);
  });

  it("queues a newly refuted fact instead of quietly recolouring a panel", async () => {
    useStore.setState({ facts: { p1: [fact(grepSpec)] } });
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockResolvedValue([] as never);
    await verifyProjectFacts("/repo", "p1");
    expect(queue).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ factId: "f1", evidence: "Cargo.toml", source: "check" }),
    );
  });

  it("does not re-queue a fact that was already refuted", async () => {
    useStore.setState({ facts: { p1: [fact(grepSpec, { status: "refuted" })] } });
    readFile.mockResolvedValue("nothing here");
    toolGrep.mockResolvedValue([] as never);
    await verifyProjectFacts("/repo", "p1");
    expect(queue).not.toHaveBeenCalled();
  });

  it("keeps going after one fact loses its evidence, and logs the pass", async () => {
    const logMemory = vi.fn();
    useStore.setState({
      logMemory,
      facts: { p1: [fact(grepSpec, { id: "a" }), fact(grepSpec, { id: "b" })] },
    });
    readFile.mockRejectedValueOnce(new Error("boom")).mockResolvedValue("rusqlite");
    const tally = await verifyProjectFacts("/repo", "p1");
    expect(tally.verified).toBe(1);
    expect(logMemory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audit", status: "ok" }),
    );
  });
});
