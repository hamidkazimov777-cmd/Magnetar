import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Project, Session } from "./types";

vi.mock("./api", () => ({ api: { complete: vi.fn() } }));
vi.mock("./db", () => ({ db: { listKnowledgeNodes: vi.fn(async () => []) } }));

const { api } = await import("./api");
const { db } = await import("./db");
const { buildOutgoing, maybeSummarize } = await import("./handoff");
const { useStore } = await import("./store");

const complete = vi.mocked(api.complete);
const listKnowledgeNodes = vi.mocked(db.listKnowledgeNodes);

const msg = (id: string, role: ChatMessage["role"], content: string, model?: string): ChatMessage =>
  ({ id, role, content, createdAt: Number(id.replace(/\D/g, "")) || 0, model }) as ChatMessage;

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "chat",
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Magnetar",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const conn = { id: "c1", name: "c1", kind: "openai_compat" as const, baseUrl: "https://example.invalid/v1" };

beforeEach(() => {
  vi.clearAllMocks();
  listKnowledgeNodes.mockResolvedValue([]);
  useStore.setState({
    projects: [],
    facts: {},
    decisions: {},
    connections: [],
    models: {},
    modelStatus: {},
    activeConnectionId: undefined,
    activeModel: undefined,
    prefs: { ...useStore.getState().prefs, memoryModel: undefined },
  });
});

describe("building what actually goes to the provider", () => {
  it("states plainly that plain chat has no tools", async () => {
    const { system } = await buildOutgoing(session(), "m1");
    expect(system).toContain("NO tools");
    expect(system).toContain("Agent mode");
  });

  it("sends only the tail after a summary and carries the summary instead", async () => {
    const messages = ["m1", "m2", "m3", "m4"].map((id) => msg(id, "user", `said ${id}`));
    const { system, messages: sent } = await buildOutgoing(
      session({ messages, summary: "we agreed on X", summaryUpToId: "m2" }),
      "m1",
    );
    expect(sent.map((m) => m.id)).toEqual(["m3", "m4"]);
    expect(system).toContain("we agreed on X");
  });

  it("sends everything when the summary points at a message that is gone", async () => {
    const messages = [msg("m1", "user", "hi")];
    const { system, messages: sent } = await buildOutgoing(
      session({ messages, summary: "stale", summaryUpToId: "deleted" }),
      "m1",
    );
    expect(sent).toHaveLength(1);
    expect(system).not.toContain("stale");
  });

  it("tells a new model that another one spoke before it", async () => {
    const messages = [msg("m1", "assistant", "done", "gpt-4o")];
    const { system } = await buildOutgoing(session({ messages }), "claude-opus-5");
    expect(system).toContain("gpt-4o");
    expect(system).toContain("claude-opus-5");

    const same = await buildOutgoing(session({ messages }), "gpt-4o");
    expect(same.system).not.toContain("Pick up exactly where");
  });

  it("shows plain chat the same memory the agent gets", async () => {
    useStore.setState({
      projects: [project({ factsMigratedAt: 2 })],
      facts: {
        p1: [
          {
            id: "f1",
            projectId: "p1",
            kind: "stack",
            text: "Uses SQLite",
            origin: "extracted",
            originDetail: "Cargo.toml",
            status: "unverified",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    const { system } = await buildOutgoing(session({ projectId: "p1" }), "m1");
    // Facts with their provenance, not the old prose fields.
    expect(system).toContain("Uses SQLite");
    expect(system).toContain("read from Cargo.toml");
  });

  it("omits project context when the user hid the project", async () => {
    useStore.setState({ projects: [project({ techStack: "Rust" })] });
    const { system } = await buildOutgoing(
      session({ projectId: "p1", seesProject: false }),
      "m1",
    );
    expect(system).not.toContain("Rust");
    expect(listKnowledgeNodes).not.toHaveBeenCalled();
  });

  it("includes only the graph nodes the recent messages actually mention", async () => {
    useStore.setState({ projects: [project()] });
    listKnowledgeNodes.mockResolvedValue([
      { id: "n1", title: "Leases", nodeType: "concept", summary: "file claims" },
      { id: "n2", title: "Billing", nodeType: "concept", summary: "never" },
    ] as never);
    const { system } = await buildOutgoing(
      session({ projectId: "p1", messages: [msg("m1", "user", "how do leases work?")] }),
      "m1",
    );
    expect(system).toContain("Leases");
    expect(system).not.toContain("Billing");
  });

  it("still returns a usable prompt when the graph lookup fails", async () => {
    useStore.setState({ projects: [project({ techStack: "Rust" })] });
    listKnowledgeNodes.mockRejectedValue(new Error("db closed"));
    const { system } = await buildOutgoing(session({ projectId: "p1" }), "m1");
    expect(system).toContain("Rust");
  });
});

describe("refreshing the rolling summary", () => {
  const longSession = (over: Partial<Session> = {}) =>
    session({
      messages: Array.from({ length: 12 }, (_, i) => msg(`m${i + 1}`, "user", `line ${i + 1}`)),
      ...over,
    });

  it("does nothing until the transcript is worth compressing", async () => {
    const setSummary = vi.fn();
    await maybeSummarize(session({ messages: [msg("m1", "user", "hi")] }), conn, "m1", setSummary);
    expect(complete).not.toHaveBeenCalled();
    expect(setSummary).not.toHaveBeenCalled();
  });

  it("summarises everything but the tail and reports what it covered", async () => {
    complete.mockResolvedValue("- goal: ship step 1");
    const setSummary = vi.fn();
    await maybeSummarize(longSession(), conn, "m1", setSummary);
    expect(setSummary).toHaveBeenCalledWith("- goal: ship step 1", "m8");
    const prompt = complete.mock.calls[0][2][0].content;
    expect(prompt).toContain("line 8");
    expect(prompt).not.toContain("line 9");
  });

  it("skips work when the summary is already current", async () => {
    const setSummary = vi.fn();
    await maybeSummarize(longSession({ summaryUpToId: "m8" }), conn, "m1", setSummary);
    expect(complete).not.toHaveBeenCalled();
  });

  it("ignores an empty answer instead of storing a blank summary", async () => {
    complete.mockResolvedValue("   ");
    const setSummary = vi.fn();
    await maybeSummarize(longSession(), conn, "m1", setSummary);
    expect(setSummary).not.toHaveBeenCalled();
  });

  it("never breaks the chat when summarisation fails, and records the failure", async () => {
    complete.mockRejectedValue(new Error("provider refused"));
    const logMemory = vi.fn();
    useStore.setState({ logMemory });
    const setSummary = vi.fn();
    await expect(maybeSummarize(longSession(), conn, "m1", setSummary)).resolves.toBeUndefined();
    expect(setSummary).not.toHaveBeenCalled();
    expect(logMemory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "summary", status: "error" }),
    );
  });

  it("uses the configured background model rather than the chat model", async () => {
    const cheap = { id: "c2", name: "c2", kind: "openai_compat" as const, baseUrl: "https://x.invalid/v1" };
    useStore.setState({
      connections: [conn, cheap],
      prefs: { ...useStore.getState().prefs, memoryModel: { connectionId: "c2", model: "haiku" } },
    });
    complete.mockResolvedValue("note");
    await maybeSummarize(longSession(), conn, "expensive-model", vi.fn());
    expect(complete.mock.calls[0][0]).toEqual(cheap);
    expect(complete.mock.calls[0][1]).toBe("haiku");
  });
});
