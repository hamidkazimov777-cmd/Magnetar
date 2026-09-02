import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMemorySection,
  buildProjectMemory,
  cheapModel,
} from "./memory";
import { useStore } from "./store";
import type { Connection, MemoryFact, Project, Session } from "./types";

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Magnetar",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "chat",
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const fact = (over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: "f1",
  projectId: "p1",
  kind: "stack",
  text: "Uses SQLite",
  origin: "extracted",
  originDetail: "Cargo.toml",
  status: "unverified",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const conn = (id: string): Connection => ({
  id,
  name: id,
  kind: "openai_compat",
  baseUrl: "https://example.invalid/v1",
});

beforeEach(() => {
  useStore.setState({
    projects: [],
    facts: {},
    decisions: {},
    connections: [],
    models: {},
    modelStatus: {},
    activeConnectionId: undefined,
    activeModel: undefined,
    workspaceRoot: undefined,
  });
});

describe("project memory in the system prompt", () => {
  it("sends no memory at all when the user hid the project", () => {
    useStore.setState({ projects: [project()], workspaceRoot: "/repo" });
    const out = buildProjectMemory(session({ projectId: "p1", seesProject: false }));
    expect(out).toContain("Project context hidden");
    expect(out).not.toContain("/repo");
    expect(out).not.toContain("Magnetar");
  });

  it("gives the agent the open folder as a default, not a fence", () => {
    useStore.setState({ workspaceRoot: "/repo" });
    const out = buildProjectMemory(session());
    expect(out).toContain("/repo");
    expect(out).toContain("It is not a boundary");
  });

  it("tells the agent not to go hunting when no folder is open", () => {
    const out = buildProjectMemory(session());
    expect(out).toContain("No project folder is open");
    expect(out).toContain("new_project");
    expect(out).not.toContain("Workspace root");
  });

  it("renders facts with their provenance once a project is selected", () => {
    useStore.setState({
      projects: [project({ path: "/repo", description: "local AI IDE" })],
      facts: { p1: [fact({ status: "verified", checkedAt: Date.UTC(2026, 7, 26) })] },
      workspaceRoot: "/repo",
    });
    const out = buildProjectMemory(session({ projectId: "p1" }), "database");
    expect(out).toContain("Project memory: Magnetar");
    expect(out).toContain("local AI IDE");
    expect(out).toContain("Uses SQLite");
    expect(out).toContain("read from Cargo.toml; verified 2026-08-26");
  });

  it("keeps a refuted fact out of the prompt entirely", () => {
    useStore.setState({
      projects: [project({ factsMigratedAt: 2 })],
      facts: { p1: [fact({ text: "Uses MongoDB", status: "refuted" })] },
    });
    expect(buildProjectMemory(session({ projectId: "p1" }))).not.toContain("MongoDB");
  });

  it("falls back to the legacy prose only while a project is unmigrated", () => {
    useStore.setState({ projects: [project({ techStack: "Rust and React" })] });
    expect(buildProjectMemory(session({ projectId: "p1" }))).toContain("Rust and React");

    useStore.setState({ projects: [project({ techStack: "Rust and React", factsMigratedAt: 2 })] });
    expect(buildProjectMemory(session({ projectId: "p1" }))).not.toContain("Rust and React");
  });

  it("stops at the workspace notice when the session names no project", () => {
    useStore.setState({ projects: [project()], workspaceRoot: "/repo" });
    expect(buildProjectMemory(session())).not.toContain("Project memory");
  });
});

describe("one memory, whichever track asks for it", () => {
  it("gives the agent and plain chat the same facts", () => {
    useStore.setState({
      projects: [project({ factsMigratedAt: 2 })],
      facts: { p1: [fact({ text: "Uses SQLite" })] },
      workspaceRoot: "/repo",
    });
    const shared = buildMemorySection({ projectId: "p1" });
    // The agent prompt is the shared section plus instructions about tools;
    // the section itself must be the same text, not a second rendering.
    expect(buildProjectMemory(session({ projectId: "p1" }))).toContain(shared);
    expect(shared).toContain("Uses SQLite");
  });

  it("says nothing without a project, or when the project is hidden", () => {
    useStore.setState({ projects: [project()] });
    expect(buildMemorySection(undefined)).toBe("");
    expect(buildMemorySection({ projectId: "gone" })).toBe("");
    expect(buildMemorySection({ projectId: "p1", seesProject: false })).toBe("");
  });

  it("can be asked for a project without a conversation", () => {
    // The subscription bridge exports memory with no session in hand.
    useStore.setState({
      projects: [project({ factsMigratedAt: 2 })],
      facts: { p1: [fact({ text: "Uses SQLite" })] },
    });
    expect(buildMemorySection({ projectId: "p1" })).toContain("Uses SQLite");
  });

  it("leaves the tool instructions out of the shared section", () => {
    useStore.setState({
      projects: [project({ factsMigratedAt: 2 })],
      facts: { p1: [fact()] },
      workspaceRoot: "/repo",
    });
    const shared = buildMemorySection({ projectId: "p1" });
    expect(shared).not.toContain("search_code");
    expect(shared).not.toContain("Workspace root");
  });
});

describe("picking the model for background memory work", () => {
  it("obeys an explicit setting before any heuristic", () => {
    useStore.setState({
      connections: [conn("c1"), conn("c2")],
      models: { c1: [{ id: "gpt-4o-mini" }], c2: [{ id: "big-model" }] },
      prefs: { ...useStore.getState().prefs, memoryModel: { connectionId: "c2", model: "big-model" } },
    });
    expect(cheapModel()).toEqual({ connection: conn("c2"), model: "big-model" });
  });

  it("prefers a small model over the expensive one", () => {
    useStore.setState({
      connections: [conn("c1")],
      models: { c1: [{ id: "big-model" }, { id: "claude-haiku-4-5" }] },
      prefs: { ...useStore.getState().prefs, memoryModel: undefined },
    });
    expect(cheapModel()?.model).toBe("claude-haiku-4-5");
  });

  it("never re-picks a model the provider already refused", () => {
    useStore.setState({
      connections: [conn("c1")],
      models: { c1: [{ id: "gpt-4o-mini" }, { id: "big-model" }] },
      modelStatus: { "c1::gpt-4o-mini": "denied" },
      prefs: { ...useStore.getState().prefs, memoryModel: undefined },
    });
    expect(cheapModel()?.model).toBe("big-model");
  });

  it("returns null rather than a guess when nothing is usable", () => {
    useStore.setState({
      connections: [conn("c1")],
      models: { c1: [{ id: "big-model" }] },
      modelStatus: { "c1::big-model": "denied" },
      prefs: { ...useStore.getState().prefs, memoryModel: undefined },
    });
    expect(cheapModel()).toBeNull();
    useStore.setState({ connections: [], models: {} });
    expect(cheapModel()).toBeNull();
  });
});
