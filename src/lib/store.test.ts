import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Divergence, MemoryFact, Project, Session } from "./types";

// Every write-through goes to SQLite in the background. The store's job here is
// the in-memory transition; the DB call is stubbed so a missing Tauri host does
// not turn a state assertion into a connection error.
vi.mock("./db", () => ({
  db: new Proxy({} as Record<string, unknown>, {
    get: () => vi.fn(async () => []),
  }),
}));

// The workspace slice tells the backend which folder is open; that call is the
// only reason the store touches the API layer.
vi.mock("./api", () => ({
  HAS_BACKEND: false,
  api: {
    setWorkspaceRoot: vi.fn(async () => {}),
    setReadOnly: vi.fn(async () => {}),
    workspaceTrusted: vi.fn(async () => true),
    trustWorkspace: vi.fn(async () => {}),
  },
}));

const { api } = await import("./api");
const { useStore } = await import("./store");
const { NEW_CHAT_TITLE } = await import("./store");

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

const fact = (over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: "f1",
  projectId: "p1",
  kind: "stack",
  text: "Uses SQLite",
  origin: "extracted",
  status: "unverified",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const divergence = (over: Partial<Divergence> = {}): Divergence => ({
  id: "d1",
  projectId: "p1",
  summary: "memory disagrees with the code",
  status: "open",
  source: "check",
  createdAt: 1,
  ...over,
});

const reset = () =>
  useStore.setState({
    connections: [],
    models: {},
    sessions: [],
    activeSessionId: undefined,
    activeConnectionId: undefined,
    activeModel: undefined,
    activeTrack: "chat",
    projects: [],
    activeProjectId: undefined,
    facts: {},
    divergences: {},
    tabs: [],
    activeTabPath: undefined,
    pendingReveal: undefined,
    changes: [],
    workspaceRoot: undefined,
    recentFolders: [],
    centerView: "editor",
    sidePanel: "explorer",
    sidebarOpen: true,
    agentPanelOpen: false,
    pendingPrompt: undefined,
  });

beforeEach(reset);

/* The split into domain slices is only safe if the actions that reach across
   domains still do so. These are exactly those actions. */

describe("the folder is the unit of work", () => {
  it("tells the backend which folder to contain paths against", () => {
    const setWorkspaceRoot = vi.mocked(api.setWorkspaceRoot);
    setWorkspaceRoot.mockClear();

    useStore.getState().setWorkspaceRoot("/repo");
    expect(setWorkspaceRoot).toHaveBeenCalledWith("/repo");

    // Closing has to clear it too, or the last folder keeps authorising work
    // after the user has left it.
    useStore.getState().closeFolder();
    expect(setWorkspaceRoot).toHaveBeenLastCalledWith(undefined);
  });

  it("closing it clears the tabs, the unreviewed edits and the project", () => {
    const st = useStore.getState();
    st.setWorkspaceRoot("/repo");
    st.openTab({ path: "/repo/a.ts", name: "a.ts" });
    st.addChange({ path: "/repo/a.ts", before: null, after: "x", tool: "write_file" });
    useStore.setState({ activeProjectId: "p1" });

    useStore.getState().closeFolder();

    const after = useStore.getState();
    expect(after.workspaceRoot).toBeUndefined();
    expect(after.tabs).toEqual([]);
    expect(after.activeTabPath).toBeUndefined();
    expect(after.changes).toEqual([]);
    expect(after.activeProjectId).toBeUndefined();
    // The folder is still offered on the welcome screen after it is closed.
    expect(after.recentFolders).toEqual(["/repo"]);
  });

  it("asks whether a newly opened folder is trusted, and mirrors the answer", async () => {
    const workspaceTrusted = vi.mocked(api.workspaceTrusted);
    workspaceTrusted.mockClear().mockResolvedValue(false);

    useStore.getState().setWorkspaceRoot("/repo");
    await vi.waitFor(() => expect(useStore.getState().workspaceTrusted).toBe(false));

    // Vouching for it has to reach the backend: the store flag is a mirror, and
    // the refusal happens in Rust.
    const trustWorkspace = vi.mocked(api.trustWorkspace);
    trustWorkspace.mockClear();
    useStore.getState().trustWorkspace();
    await vi.waitFor(() => expect(useStore.getState().workspaceTrusted).toBe(true));
    expect(trustWorkspace).toHaveBeenCalled();

    // With nothing open there is nothing to distrust.
    useStore.getState().closeFolder();
    expect(useStore.getState().workspaceTrusted).toBe(true);
    workspaceTrusted.mockResolvedValue(true);
  });

  it("keeps recent folders newest-first, deduplicated and capped", () => {
    const { setWorkspaceRoot } = useStore.getState();
    for (let i = 0; i < 9; i++) setWorkspaceRoot(`/repo/${i}`);
    setWorkspaceRoot("/repo/3");
    const recent = useStore.getState().recentFolders;
    expect(recent[0]).toBe("/repo/3");
    expect(recent).toHaveLength(8);
    expect(new Set(recent).size).toBe(8);
  });
});

describe("opening files", () => {
  it("reveals a line by opening the tab in the same action", () => {
    useStore.setState({ centerView: "settings" });
    useStore.getState().revealInFile("/repo/src/a.ts", 42, 7);
    const st = useStore.getState();
    expect(st.tabs.map((t) => t.path)).toEqual(["/repo/src/a.ts"]);
    expect(st.tabs[0].name).toBe("a.ts");
    expect(st.activeTabPath).toBe("/repo/src/a.ts");
    expect(st.pendingReveal).toEqual({ path: "/repo/src/a.ts", line: 42, column: 7 });
    // Revealing a problem has to bring the editor back into view.
    expect(st.centerView).toBe("editor");
  });

  it("does not open the same file twice", () => {
    const st = useStore.getState();
    st.openTab({ path: "/repo/a.ts", name: "a.ts" });
    st.openTab({ path: "/repo/a.ts", name: "a.ts" });
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  it("focuses the neighbour that takes a closed tab's place", () => {
    const st = useStore.getState();
    for (const n of ["a", "b", "c"]) st.openTab({ path: `/repo/${n}.ts`, name: `${n}.ts` });
    useStore.getState().setActiveTab("/repo/b.ts");
    useStore.getState().closeTab("/repo/b.ts");
    expect(useStore.getState().activeTabPath).toBe("/repo/c.ts");

    // Closing an inactive tab leaves the focus alone.
    useStore.getState().closeTab("/repo/a.ts");
    expect(useStore.getState().activeTabPath).toBe("/repo/c.ts");
  });
});

describe("selecting a project", () => {
  it("adopts a conversation that is not yet anyone's work", () => {
    useStore.setState({
      projects: [project()],
      sessions: [session()],
      activeSessionId: "s1",
    });
    useStore.getState().setActiveProject("p1");
    const st = useStore.getState();
    expect(st.activeProjectId).toBe("p1");
    expect(st.sessions[0].projectId).toBe("p1");
  });

  it("does not steal a conversation that already belongs to another project", () => {
    useStore.setState({
      projects: [project(), project({ id: "p2", name: "Other" })],
      sessions: [
        session({
          projectId: "p2",
          messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
        }),
      ],
      activeSessionId: "s1",
    });
    useStore.getState().setActiveProject("p1");
    expect(useStore.getState().activeProjectId).toBe("p1");
    expect(useStore.getState().sessions[0].projectId).toBe("p2");
  });

  it("clears the active project without touching the conversation", () => {
    useStore.setState({ activeProjectId: "p1", sessions: [session()], activeSessionId: "s1" });
    useStore.getState().setActiveProject(undefined);
    expect(useStore.getState().activeProjectId).toBeUndefined();
  });
});

describe("a model choice belongs to its conversation", () => {
  it("writes the model onto the live session", () => {
    useStore.setState({
      sessions: [session()],
      activeSessionId: "s1",
      activeConnectionId: "c1",
    });
    useStore.getState().setActiveModel("claude-opus-5");
    const st = useStore.getState();
    expect(st.activeModel).toBe("claude-opus-5");
    expect(st.sessions[0].model).toBe("claude-opus-5");
    expect(st.sessions[0].connectionId).toBe("c1");
  });

  it("brings the model back when the conversation is selected again", () => {
    useStore.setState({
      sessions: [
        session({ id: "a", model: "model-a", connectionId: "c1", track: "chat" }),
        session({ id: "b", model: "model-b", connectionId: "c2", track: "agent" }),
      ],
      activeSessionId: "a",
      activeModel: "model-a",
      activeConnectionId: "c1",
    });
    useStore.getState().selectSession("b");
    const st = useStore.getState();
    expect(st.activeModel).toBe("model-b");
    expect(st.activeConnectionId).toBe("c2");
    expect(st.activeTrack).toBe("agent");
  });

  it("starts a new conversation on the current track and model", () => {
    useStore.setState({ activeTrack: "agent", activeConnectionId: "c1", activeModel: "m1" });
    const id = useStore.getState().newSession();
    const st = useStore.getState();
    expect(st.activeSessionId).toBe(id);
    expect(st.sessions[0].track).toBe("agent");
    expect(st.sessions[0].model).toBe("m1");
    expect(st.sessions[0].title).toBe(NEW_CHAT_TITLE);
  });
});

describe("switching tracks", () => {
  it("takes the centre to the studio and back", () => {
    useStore.setState({ centerView: "editor" });
    useStore.getState().switchTrack("generation");
    expect(useStore.getState().centerView).toBe("studio");

    useStore.getState().switchTrack("agent");
    expect(useStore.getState().centerView).toBe("editor");
  });

  it("returns to the conversation you were having on that track", () => {
    useStore.setState({
      sessions: [
        session({ id: "chat1", track: "chat" }),
        session({ id: "agent1", track: "agent" }),
      ],
      activeSessionId: "chat1",
      activeTrack: "chat",
    });
    useStore.getState().switchTrack("agent");
    expect(useStore.getState().activeSessionId).toBe("agent1");
  });

  it("opens a fresh one when that track has none", () => {
    useStore.setState({
      sessions: [session({ id: "chat1", track: "chat" })],
      activeSessionId: "chat1",
      activeTrack: "chat",
    });
    useStore.getState().switchTrack("agent");
    const st = useStore.getState();
    expect(st.activeSessionId).not.toBe("chat1");
    expect(st.sessions.find((x) => x.id === st.activeSessionId)?.track).toBe("agent");
  });

  it("leaves a settings page alone when moving between text tracks", () => {
    useStore.setState({
      centerView: "settings",
      sessions: [session({ track: "chat" })],
      activeSessionId: "s1",
    });
    useStore.getState().switchTrack("chat");
    expect(useStore.getState().centerView).toBe("settings");
  });
});

describe("memory keeps its own queue honest", () => {
  it("dismisses an open disagreement about a fact that was deleted", () => {
    useStore.setState({
      facts: { p1: [fact()] },
      divergences: {
        p1: [divergence(), divergence({ id: "d2", factId: "f1" })],
      },
    });
    useStore.getState().deleteFact("p1", "f1");
    const st = useStore.getState();
    expect(st.facts.p1).toEqual([]);
    // The one that named the deleted fact is dismissed; the unrelated one stays.
    expect(st.divergences.p1.find((d) => d.id === "d2")?.status).toBe("dismissed");
    expect(st.divergences.p1.find((d) => d.id === "d1")?.status).toBe("open");
  });

  it("updates a fact in place rather than appending a duplicate", () => {
    useStore.setState({ facts: { p1: [fact()] } });
    useStore.getState().saveFacts([fact({ status: "verified", checkedAt: 9 })]);
    const rows = useStore.getState().facts.p1;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("verified");
  });

  it("caps the audit log instead of growing an archive", () => {
    for (let i = 0; i < 70; i++)
      useStore.getState().logMemory({ kind: "audit", status: "ok", detail: `${i}` });
    const log = useStore.getState().memoryLog;
    expect(log).toHaveLength(60);
    expect(log[0].detail).toBe("69");
  });
});

describe("the shell", () => {
  it("asks the backend to enter read-only mode, and mirrors it for the UI", () => {
    const setReadOnly = vi.mocked(api.setReadOnly);
    setReadOnly.mockClear();
    useStore.setState({ readOnly: false });

    useStore.getState().setReadOnly(true);
    // The store flag is only a mirror: the refusal happens in Rust, so the
    // backend has to be told or the mode is decoration.
    expect(setReadOnly).toHaveBeenCalledWith(true);
    expect(useStore.getState().readOnly).toBe(true);

    useStore.getState().setReadOnly(false);
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    expect(useStore.getState().readOnly).toBe(false);
  });

  it("collapses the sidebar when the open panel's icon is clicked again", () => {
    const st = useStore.getState();
    st.setSidePanel("git");
    expect(useStore.getState().sidebarOpen).toBe(true);
    useStore.getState().setSidePanel("git");
    expect(useStore.getState().sidebarOpen).toBe(false);
    useStore.getState().setSidePanel("search");
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("surfaces the project picker with the pages that need one", () => {
    useStore.getState().setCenterView("roadmap");
    const st = useStore.getState();
    expect(st.centerView).toBe("roadmap");
    expect(st.sidePanel).toBe("project");
    expect(st.sidebarOpen).toBe(true);
  });

  it("opens the agent panel with the prompt it is handed, and hands it over once", () => {
    useStore.getState().requestPrompt("run the audit");
    expect(useStore.getState().agentPanelOpen).toBe(true);
    expect(useStore.getState().consumePrompt()).toBe("run the audit");
    expect(useStore.getState().consumePrompt()).toBeUndefined();
  });
});
