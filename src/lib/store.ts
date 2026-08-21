import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, type SessionMetaRow } from "./db";
import type { Lang } from "./i18n";
import { applyTheme, type Theme } from "./theme";
import type { ChatMessage, Connection, ModelInfo, Session } from "./types";

/** Which panel the activity bar shows in the primary (left) sidebar. */
export type SidePanel =
  | "explorer"
  | "chats"
  | "git"
  | "search"
  | "changes"
  | "problems"
  | "project";

/** What the center area renders: the code editor, or a full-width page. */
export type CenterView =
  | "editor"
  | "settings"
  | "projects"
  | "roadmap"
  | "knowledge"
  | "timeline"
  | "subscriptions";

/** An open editor tab. Tabs live in the store so the agent and Source Control
 *  can open things too. `kind: "diff"` renders a git diff instead of an editor. */
export interface EditorTab {
  path: string;
  name: string;
  kind?: "file" | "diff";
  /** Diff tabs only: show the staged diff rather than the working-tree diff. */
  staged?: boolean;
}

/** Sentinel title for a freshly created chat; the UI renders it translated. */
export const NEW_CHAT_TITLE = "__new_chat__";

/** One file mutation made by the agent, kept so the user can review and undo.
 *  `before === null` means the agent created the file. */
export interface FileChange {
  id: string;
  path: string;
  before: string | null;
  after: string;
  tool: "write_file" | "edit_file";
  at: number;
  reverted?: boolean;
}

/** User-facing behaviour switches, surfaced in Settings. */
export interface Prefs {
  /** Apply agent edits immediately and let the user review/undo (VS Code-like),
   *  instead of blocking on a confirm dialog for every single write. */
  autoApplyEdits: boolean;
  /** Shell commands are never auto-approved unless the user opts in. */
  confirmBash: boolean;
  /** How many tool-use rounds the agent may take before stopping. */
  agentMaxSteps: number;
  /** Seconds a single shell command may run (npm install/cargo build are slow). */
  bashTimeoutSecs: number;
  /** Model used for background work: project memory, handoff notes, knowledge
   *  graph. Undefined = pick automatically. Explicit is safer — the automatic
   *  pick can land on a catalogue entry the token cannot actually call. */
  memoryModel?: { connectionId: string; model: string };
  /** The bench of models helper agents run on. Tasks are handed out round
   *  robin, so three models and three parallel helpers means each task runs on
   *  a different one — mixing providers on purpose is allowed and useful.
   *  Empty means the helpers use the lead's model. */
  subagentRoster: { connectionId: string; model: string }[];
  /** How many helpers actually run at once. More than a handful is not
   *  followable on screen, and providers rate-limit anyway. */
  subagentParallel: number;
  editorFontSize: number;
  editorWordWrap: boolean;
  editorMinimap: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  autoApplyEdits: true,
  confirmBash: true,
  agentMaxSteps: 40,
  bashTimeoutSecs: 600,
  subagentParallel: 3,
  subagentRoster: [],
  editorFontSize: 13,
  editorWordWrap: false,
  editorMinimap: true,
};

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

const now = () => Date.now();

/** The canon (sessions/messages) lives in SQLite; connections and preferences
 *  stay in localStorage. Mutations update memory immediately and write through
 *  to the DB in the background (fire-and-forget — chat never blocks on disk). */

function metaOf(s: Session): SessionMetaRow {
  return {
    id: s.id,
    title: s.title,
    connectionId: s.connectionId ?? null,
    model: s.model ?? null,
    summary: s.summary ?? null,
    summaryUpToId: s.summaryUpToId ?? null,
    projectId: s.projectId ?? null,
    track: s.track ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

const persistMeta = (s: Session) => void db.saveSession(metaOf(s)).catch(() => {});

interface State {
  connections: Connection[];
  activeConnectionId?: string;
  activeModel?: string;
  models: Record<string, ModelInfo[]>;
  adaptive: boolean;
  /** Mirror of the active conversation's track, kept for the UI. The truth is
   *  `session.track`; toggling this switches tracks, which is why turning the
   *  agent off does not disarm the conversation you are in — it moves you to
   *  the other one, with its own model and its own history. */
  agentMode: boolean;
  setAgentMode: (on: boolean) => void;
  /** Move to a track, adopting (or starting) that track's conversation. */
  switchTrack: (track: "agent" | "chat") => void;
  workspaceRoot?: string;
  setWorkspaceRoot: (path: string | undefined) => void;
  /** Most-recently opened folders, newest first (for the welcome screen). */
  recentFolders: string[];
  closeFolder: () => void;

  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;

  /** Agent file mutations awaiting review. */
  changes: FileChange[];
  addChange: (c: Omit<FileChange, "id" | "at">) => void;
  markReverted: (id: string) => void;
  clearChanges: () => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Light / dark / follow-OS. Light is the default on a fresh install. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Learn mode: hover any control to get a short explanation of what it does
   *  and when it runs. Off by default; toggled by the "i" button in the rail. */
  hintsOn: boolean;
  toggleHints: (v?: boolean) => void;
  /** Per subscription provider: present a desktop Safari user agent in the
   *  embedded browser. Needed to get Google sign-in through, but it can break
   *  the app afterwards (ChatGPT's composer), so it is a per-site switch. */
  subsSafariUa: Record<string, boolean>;
  setSubsSafariUa: (providerId: string, on: boolean) => void;

  // --- Workspace shell -----------------------------------------------------
  /** False until the user finishes (or skips) the first-launch walkthrough. */
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
  sidePanel: SidePanel;
  sidebarOpen: boolean;
  setSidePanel: (p: SidePanel) => void;
  toggleSidebar: () => void;
  centerView: CenterView;
  setCenterView: (v: CenterView) => void;
  terminalOpen: boolean;
  toggleTerminal: (v?: boolean) => void;
  agentPanelOpen: boolean;
  toggleAgentPanel: (v?: boolean) => void;
  /** Bumped to force the file tree to re-read from disk (after agent edits). */
  explorerVersion: number;
  refreshExplorer: () => void;
  /** Git status letter per repo-relative path, for badges in the file tree. */
  gitStatus: Record<string, string>;
  setGitStatus: (map: Record<string, string>) => void;

  // --- Editor tabs ---------------------------------------------------------
  tabs: EditorTab[];
  activeTabPath?: string;
  openTab: (tab: EditorTab) => void;
  closeTab: (path: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (path: string) => void;

  sessions: Session[];
  activeSessionId?: string;
  hydrated: boolean;

  projects: import("./types").Project[];
  activeProjectId?: string;

  loadProjects: () => Promise<void>;
  setActiveProject: (id: string | undefined) => void;
  attachSessionToProject: (sessionId: string, projectId: string) => void;
  addProject: (p: import("./types").Project) => void;
  updateProject: (p: import("./types").Project) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  /** Project memory as facts, keyed by project id. Loaded per project rather
   *  than all at once: only the open project's memory is ever consulted. */
  facts: Record<string, import("./types").MemoryFact[]>;
  loadFacts: (projectId: string) => Promise<void>;
  /** Insert or update a batch. One call, one write — callers routinely produce
   *  a dozen facts at a time (an audit, a migration), and a save per fact made
   *  the panel flicker through a dozen intermediate states. */
  saveFacts: (facts: import("./types").MemoryFact[]) => void;
  deleteFact: (projectId: string, id: string) => void;

  /** Queued contradictions between memory and the code, keyed by project. */
  divergences: Record<string, import("./types").Divergence[]>;
  loadDivergences: (projectId: string) => Promise<void>;
  saveDivergence: (d: import("./types").Divergence) => void;

  /** The decision log, keyed by project id. Newest first. */
  decisions: Record<string, import("./types").Decision[]>;
  loadDecisions: (projectId: string) => Promise<void>;
  saveDecision: (d: import("./types").Decision) => void;
  deleteDecision: (projectId: string, id: string) => void;

  /** Audit trail of every background write to project memory. */
  memoryLog: import("./types").MemoryEvent[];
  logMemory: (
    e: Omit<import("./types").MemoryEvent, "id" | "at">,
  ) => void;
  clearMemoryLog: () => void;

  /** Line a newly opened tab should scroll to (set by Problems / Search).
   *  The editor consumes and clears it once the file is on screen. */
  pendingReveal?: { path: string; line: number; column?: number };
  revealInFile: (path: string, line: number, column?: number) => void;
  clearReveal: () => void;

  /** Latest result per project check (types, lint, tests). */
  checkRuns: Record<string, import("./problems").CheckRun>;
  setCheckRun: (id: string, run: import("./problems").CheckRun) => void;

  /** State of the code-search index for the open folder. */
  indexState: { status: "unknown" | "building" | "ready" | "error"; files?: number; at?: number };
  setIndexState: (s: State["indexState"]) => void;

  hydrate: () => Promise<void>;

  addConnection: (c: Omit<Connection, "id">) => string;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  setActiveModel: (model: string) => void;
  setModels: (connectionId: string, models: ModelInfo[]) => void;
  setActive: (connectionId: string, model: string) => void;
  setAdaptive: (on: boolean) => void;

  setSummary: (sessionId: string, summary: string, upToId: string) => void;

  newSession: (track?: "agent" | "chat") => string;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  addMessage: (sessionId: string, m: Omit<ChatMessage, "id" | "createdAt">) => string;
  appendToMessage: (sessionId: string, messageId: string, delta: string) => void;
  setMessageContent: (sessionId: string, messageId: string, content: string) => void;
  /** Append a chunk of the model's thinking, shown collapsed above the answer. */
  appendReasoning: (sessionId: string, messageId: string, delta: string) => void;
  /** Attach cost and timing to a finished message. */
  setMessageMeta: (
    sessionId: string,
    messageId: string,
    meta: Partial<Pick<ChatMessage, "usage" | "durationMs" | "thinkingMs">>,
  ) => void;
  /** Rewrite a user turn and drop everything that came after it.
   *
   *  Editing a question means the answers to the old wording are no longer
   *  part of the conversation — keeping them would have the model reading a
   *  discussion that never took place. Returns the messages that remain, so
   *  the caller can resend the turn.
   */
  editMessage: (sessionId: string, messageId: string, content: string) => ChatMessage[];

  /** Persist a message's current in-memory content to the DB (e.g. after a stream ends). */
  persistMessage: (sessionId: string, messageId: string) => void;

  /** The shell command (or other tool) running right now, if any. The composer
   *  uses it to offer "interrupt and deliver my message": while a command is
   *  running the agent loop is blocked awaiting it, so a queued message would
   *  not be read until it finishes — which is useless when it has hung. */
  runningTool?: { name: string; startedAt: number };
  setRunningTool: (t: { name: string; startedAt: number } | undefined) => void;

  /** True while an agent run is in flight. This lives in the store, not in
   *  React state: several entry points can start a run (composer, command
   *  palette, pendingPrompt), and a local flag let them race — the user ended
   *  up with several runs going at once, each answering nobody. */
  agentRunning: boolean;
  setAgentRunning: (v: boolean) => void;

  /** Helper agents currently running, keyed by run id. Transient — a run is
   *  process, not canon, and never survives a restart. Kept in the store
   *  rather than in React state because several places start runs, and a stale
   *  local flag is what let parallel runs overlap before (Entry 48). */
  subagents: Record<string, import("./types").SubagentRun>;
  setSubagent: (
    id: string,
    patch: Partial<import("./types").SubagentRun> & Pick<import("./types").SubagentRun, "id"> | Partial<import("./types").SubagentRun>,
  ) => void;
  clearSubagents: () => void;

  /** What the user typed while an agent run was in flight. The run folds these
   *  in before its next model call, so a long run can be steered or questioned
   *  instead of ignoring the user until it finishes. */
  agentInterjections: string[];
  pushAgentInterjection: (text: string) => void;
  clearAgentInterjections: () => void;

  // --- Agent run trace (transient: process, not canon — never persisted) ----
  agentTrace: Record<string, import("./agent").AgentToolEvent[]>;
  pushAgentEvent: (messageId: string, e: import("./agent").AgentToolEvent) => void;
  clearAgentTrace: (messageId: string) => void;

  // --- Last request error, shown as a retryable banner in the chat ----------
  lastError?: { message: string; sessionId: string };
  setLastError: (e: { message: string; sessionId: string } | undefined) => void;

  /** Per-model health learned from real calls: models a token cannot use are
   *  marked so the picker can warn instead of failing again. */
  modelStatus: Record<string, "ok" | "denied">;
  setModelStatus: (connectionId: string, model: string, status: "ok" | "denied") => void;
  /** Whether a model really performs native function-calling. Learned from the
   *  first agent turn: providers happily accept `tools` and then ignore them. */
  modelTools: Record<string, "native" | "react">;
  setModelTools: (connectionId: string, model: string, mode: "native" | "react") => void;
  /** Forget how a model was driven, so the next run re-detects it. Needed
   *  because a wrong "react" mark otherwise persists forever. */
  clearModelTools: (connectionId: string, model: string) => void;

  /** Why the last project-memory analysis failed (shown in the Explorer). */
  memoryError?: string;
  setMemoryError: (e: string | undefined) => void;

  /** Exactly what was sent to the model as context on the last turn, so the
   *  user can inspect it instead of guessing where an answer came from. */
  lastContext?: { system: string; model: string; at: number };
  setLastContext: (c: { system: string; model: string; at: number }) => void;

  /** Set when the user approves shell commands for the rest of this session,
   *  so a long build does not ask on every single command. Never persisted. */
  trustCommands: boolean;
  setTrustCommands: (v: boolean) => void;

  /** One-shot text handed to the agent composer (e.g. "Run audit" → /cto). */
  pendingPrompt?: string;
  requestPrompt: (text: string) => void;
  consumePrompt: () => string | undefined;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      connections: [],
      models: {},
      adaptive: false,
      agentMode: false,
      setAgentMode: (on) => get().switchTrack(on ? "agent" : "chat"),
      recentFolders: [],
      setWorkspaceRoot: (path) =>
        set((s) => ({
          workspaceRoot: path,
          recentFolders: path
            ? [path, ...s.recentFolders.filter((p) => p !== path)].slice(0, 8)
            : s.recentFolders,
        })),
      closeFolder: () =>
        set({
          workspaceRoot: undefined,
          tabs: [],
          activeTabPath: undefined,
          changes: [],
          activeProjectId: undefined,
        }),

      prefs: DEFAULT_PREFS,
      setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),

      changes: [],
      addChange: (c) =>
        set((s) => ({
          changes: [
            ...s.changes,
            { ...c, id: uid(), at: Date.now() },
          ],
        })),
      markReverted: (id) =>
        set((s) => ({
          changes: s.changes.map((c) => (c.id === id ? { ...c, reverted: true } : c)),
        })),
      clearChanges: () => set({ changes: [] }),
      lang: "ru",
      setLang: (lang) => set({ lang }),
      theme: "light",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      hintsOn: false,
      toggleHints: (v) => set((s) => ({ hintsOn: v ?? !s.hintsOn })),
      // Gemini defaults to on: it is behind Google sign-in, which is exactly
      // the flow the plain webview user agent gets refused for.
      subsSafariUa: { gemini: true },
      setSubsSafariUa: (providerId, on) =>
        set((s) => ({ subsSafariUa: { ...s.subsSafariUa, [providerId]: on } })),

      onboarded: false,
      setOnboarded: (v) => set({ onboarded: v }),
      sidePanel: "explorer",
      sidebarOpen: true,
      setSidePanel: (p) =>
        set((s) => ({
          sidePanel: p,
          // Clicking the active icon collapses the panel, like VS Code.
          sidebarOpen: s.sidePanel === p ? !s.sidebarOpen : true,
        })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      centerView: "editor",
      setCenterView: (v) =>
        set(
          // Project pages need a project selected — surface the picker with them.
          v === "projects" || v === "roadmap" || v === "knowledge" || v === "timeline"
            ? { centerView: v, sidePanel: "project", sidebarOpen: true }
            : { centerView: v },
        ),
      terminalOpen: false,
      toggleTerminal: (v) => set((s) => ({ terminalOpen: v ?? !s.terminalOpen })),
      agentPanelOpen: true,
      toggleAgentPanel: (v) =>
        set((s) => ({ agentPanelOpen: v ?? !s.agentPanelOpen })),
      explorerVersion: 0,
      refreshExplorer: () => set((s) => ({ explorerVersion: s.explorerVersion + 1 })),
      gitStatus: {},
      setGitStatus: (map) => set({ gitStatus: map }),

      tabs: [],
      openTab: (tab) =>
        set((s) => ({
          tabs: s.tabs.some((x) => x.path === tab.path) ? s.tabs : [...s.tabs, tab],
          activeTabPath: tab.path,
          centerView: "editor",
        })),
      closeTab: (path) =>
        set((s) => {
          const idx = s.tabs.findIndex((x) => x.path === path);
          const tabs = s.tabs.filter((x) => x.path !== path);
          if (s.activeTabPath !== path) return { tabs };
          // Focus the neighbour that takes the closed tab's place.
          const next = tabs[Math.min(idx, tabs.length - 1)];
          return { tabs, activeTabPath: next?.path };
        }),
      closeAllTabs: () => set({ tabs: [], activeTabPath: undefined }),
      setActiveTab: (path) => set({ activeTabPath: path, centerView: "editor" }),

      sessions: [],
      projects: [],
      hydrated: false,

      hydrate: async () => {
        try {
          // Connections live in SQLite (durable). Migrate any legacy localStorage
          // connections into the DB on first run, then use the DB as the source.
          const dbConns = await db.listConnections();
          if (dbConns.length > 0) {
            const connections = dbConns.map((c) => ({
                id: c.id,
                name: c.name,
                kind: c.kind as Connection["kind"],
                baseUrl: c.baseUrl,
                scope: c.scope ?? undefined,
                caPath: c.caPath ?? undefined,
              }));
            // SQLite is the source of truth. A persisted active id can point to a
            // connection that was deleted, or be absent after a WebView reset.
            // Always promote a valid saved connection so the chat is usable.
            set((s) => ({
              connections,
              activeConnectionId: connections.some((c) => c.id === s.activeConnectionId)
                ? s.activeConnectionId
                : connections[0]?.id,
              // An existing install is already set up — don't re-run the
              // first-launch walkthrough on upgrade.
              onboarded: s.onboarded || connections.length > 0,
            }));
          } else {
            // migrate whatever was persisted in localStorage
            for (const c of get().connections) {
              void db
                .saveConnection({
                  id: c.id,
                  name: c.name,
                  kind: c.kind,
                  baseUrl: c.baseUrl,
                  scope: c.scope ?? null,
                  caPath: c.caPath ?? null,
                  createdAt: Date.now(),
                })
                .catch(() => {});
            }
          }

          const projects = await db.listProjects();
          set({ projects });
          const metas = await db.listSessions();
          const sessions: Session[] = await Promise.all(
            metas.map(async (m) => {
              const rows = await db.loadMessages(m.id);
              return {
                id: m.id,
                title: m.title,
                connectionId: m.connectionId ?? undefined,
                model: m.model ?? undefined,
                summary: m.summary ?? undefined,
                summaryUpToId: m.summaryUpToId ?? undefined,
                projectId: m.projectId ?? undefined,
                // Conversations that predate tracks are agent chats: that is
                // all Magnetar had, and every one of them was tool-enabled.
                track: (m.track as Session["track"]) ?? "agent",
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
                messages: rows.map((r) => ({
                  id: r.id,
                  role: r.role as ChatMessage["role"],
                  content: r.content,
                  model: r.model ?? undefined,
                  createdAt: r.createdAt,
                })),
              };
            }),
          );
          set((s) => ({
            sessions,
            activeSessionId: s.activeSessionId ?? sessions[0]?.id,
            hydrated: true,
          }));
        } catch {
          set({ hydrated: true });
        }
      },

      facts: {},

      loadFacts: async (projectId) => {
        try {
          const rows = await db.listFacts(projectId);
          set((s) => ({ facts: { ...s.facts, [projectId]: rows } }));
          // Say how many arrived. An empty panel has two very different causes
          // — nothing stored, or nothing delivered — and they need telling
          // apart without a debugger.
          get().logMemory({
            kind: "audit",
            status: "ok",
            detail: `facts loaded: ${rows.length}`,
            projectId,
          });
        } catch (e) {
          // Never silent: a swallowed failure here looks exactly like a project
          // that has no memory, and that is indistinguishable from a bug.
          get().logMemory({
            kind: "audit",
            status: "error",
            detail: `facts: ${String(e).slice(0, 160)}`,
            projectId,
          });
        }
      },

      saveFacts: (rows) => {
        if (!rows.length) return;
        void db.saveFacts(rows).catch(() => {});
        set((s) => {
          const next = { ...s.facts };
          for (const f of rows) {
            const list = next[f.projectId] ?? [];
            const at = list.findIndex((x) => x.id === f.id);
            next[f.projectId] =
              at < 0 ? [...list, f] : list.map((x) => (x.id === f.id ? f : x));
          }
          return { facts: next };
        });
      },

      deleteFact: (projectId, id) => {
        void db.deleteFact(id).catch(() => {});
        set((s) => ({
          facts: {
            ...s.facts,
            [projectId]: (s.facts[projectId] ?? []).filter((x) => x.id !== id),
          },
        }));
        // A queued disagreement about a fact that no longer exists is nothing
        // but noise in the pile — and a pile of noise is a pile nobody opens.
        for (const d of get().divergences[projectId] ?? []) {
          if (d.factId === id && d.status === "open")
            get().saveDivergence({ ...d, status: "dismissed", resolvedAt: now() });
        }
      },

      divergences: {},

      loadDivergences: async (projectId) => {
        try {
          const rows = await db.listDivergences(projectId);
          set((s) => ({ divergences: { ...s.divergences, [projectId]: rows } }));
        } catch (e) {
          get().logMemory({
            kind: "audit",
            status: "error",
            detail: `divergences: ${String(e).slice(0, 160)}`,
            projectId,
          });
        }
      },

      saveDivergence: (d) => {
        void db.saveDivergence(d).catch(() => {});
        set((s) => {
          const list = s.divergences[d.projectId] ?? [];
          const at = list.findIndex((x) => x.id === d.id);
          return {
            divergences: {
              ...s.divergences,
              [d.projectId]:
                at < 0 ? [d, ...list] : list.map((x) => (x.id === d.id ? d : x)),
            },
          };
        });
      },

      decisions: {},

      loadDecisions: async (projectId) => {
        try {
          const rows = await db.listDecisions(projectId);
          set((s) => ({ decisions: { ...s.decisions, [projectId]: rows } }));
        } catch (e) {
          get().logMemory({
            kind: "audit",
            status: "error",
            detail: `decisions: ${String(e).slice(0, 160)}`,
            projectId,
          });
        }
      },

      saveDecision: (d) => {
        void db.saveDecision(d).catch(() => {});
        set((s) => {
          const list = s.decisions[d.projectId] ?? [];
          const at = list.findIndex((x) => x.id === d.id);
          return {
            decisions: {
              ...s.decisions,
              [d.projectId]:
                at < 0 ? [d, ...list] : list.map((x) => (x.id === d.id ? d : x)),
            },
          };
        });
      },

      deleteDecision: (projectId, id) => {
        void db.deleteDecision(id).catch(() => {});
        set((s) => ({
          decisions: {
            ...s.decisions,
            [projectId]: (s.decisions[projectId] ?? []).filter((x) => x.id !== id),
          },
        }));
      },

      loadProjects: async () => {
        const projects = await db.listProjects();
        set({ projects });
      },

      // Selecting a project also re-points the current chat at it, as long as
      // that chat is not already someone else's work. Without this the chat
      // keeps whatever project it was born with (often none), and every
      // memory-writing background task silently skips it.
      setActiveProject: (id) =>
        set((s) => {
          if (!id) return { activeProjectId: undefined };
          const cur = s.sessions.find((x) => x.id === s.activeSessionId);
          const adoptable = cur && (!cur.projectId || cur.messages.length === 0);
          if (!adoptable) return { activeProjectId: id };
          const sessions = s.sessions.map((x) =>
            x.id === cur.id ? { ...x, projectId: id, updatedAt: now() } : x,
          );
          persistMeta(sessions.find((x) => x.id === cur.id)!);
          return { activeProjectId: id, sessions };
        }),

      addProject: (p) => {
        void db.saveProject(p).catch(() => {});
        set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id }));
      },

      renameProject: (id, name) => {
        const p = get().projects.find((x) => x.id === id);
        if (!p || !name.trim()) return;
        const next = { ...p, name: name.trim(), updatedAt: now() };
        void db.saveProject(next).catch(() => {});
        set((s) => ({ projects: s.projects.map((x) => (x.id === id ? next : x)) }));
      },

      updateProject: (p) => {
        void db.saveProject(p).catch(() => {});
        set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? p : x)) }));
      },

      deleteProject: (id) => {
        void db.deleteProject(id).catch(() => {});
        set((s) => {
          const projects = s.projects.filter((x) => x.id !== id);
          return {
            projects,
            activeProjectId: s.activeProjectId === id ? undefined : s.activeProjectId,
          };
        });
      },

      // The log is capped: it is a recent-activity feed, not an archive.
      memoryLog: [],
      logMemory: (e) =>
        set((s) => ({
          memoryLog: [{ ...e, id: uid(), at: Date.now() }, ...s.memoryLog].slice(0, 60),
        })),
      clearMemoryLog: () => set({ memoryLog: [] }),

      // Opening the tab and asking for the line are one intent, so they are one
      // action — otherwise the reveal races the file load.
      revealInFile: (path, line, column) => {
        get().openTab({ path, name: path.split(/[/\\]/).pop() ?? path });
        set({ pendingReveal: { path, line, column } });
      },
      clearReveal: () => set({ pendingReveal: undefined }),

      checkRuns: {},
      setCheckRun: (id, run) =>
        set((s) => ({ checkRuns: { ...s.checkRuns, [id]: run } })),

      indexState: { status: "unknown" },
      setIndexState: (indexState) => set({ indexState }),

      setModels: (connectionId, models) =>
        set((s) => ({ models: { ...s.models, [connectionId]: models } })),

      setActive: (connectionId, model) =>
        set({ activeConnectionId: connectionId, activeModel: model }),

      attachSessionToProject: (sessionId: string, projectId: string) =>
        set((s) => {
          const sessions = s.sessions.map((x) =>
            x.id === sessionId ? { ...x, projectId, updatedAt: Date.now() } : x,
          );
          const sess = sessions.find((x) => x.id === sessionId);
          if (sess) persistMeta(sess);
          return { sessions };
        }),

      setAdaptive: (on) => set({ adaptive: on }),

      addConnection: (c) => {
        const id = uid();
        set((s) => ({
          connections: [...s.connections, { ...c, id }],
          activeConnectionId: s.activeConnectionId ?? id,
        }));
        void db
          .saveConnection({
            id,
            name: c.name,
            kind: c.kind,
            baseUrl: c.baseUrl,
            scope: c.scope ?? null,
            caPath: c.caPath ?? null,
            createdAt: Date.now(),
          })
          .catch(() => {});
        return id;
      },

      removeConnection: (id) => {
        void db.deleteConnection(id).catch(() => {});
        set((s) => {
          const connections = s.connections.filter((c) => c.id !== id);
          return {
            connections,
            activeConnectionId:
              s.activeConnectionId === id ? connections[0]?.id : s.activeConnectionId,
            activeModel: s.activeConnectionId === id ? undefined : s.activeModel,
          };
        });
      },

      setActiveConnection: (id) =>
        set({ activeConnectionId: id, activeModel: undefined }),

      // A model choice belongs to the conversation it was made in, so coming
      // back to that conversation brings the model back with it.
      setActiveModel: (model) => {
        set({ activeModel: model });
        const st = get();
        const sess = st.sessions.find((x) => x.id === st.activeSessionId);
        if (!sess) return;
        const next = { ...sess, model, connectionId: st.activeConnectionId, updatedAt: now() };
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === next.id ? next : x)),
        }));
        persistMeta(next);
      },

      setSummary: (sessionId, summary, upToId) =>
        set((s) => {
          const sessions = s.sessions.map((x) =>
            x.id === sessionId
              ? { ...x, summary, summaryUpToId: upToId, updatedAt: now() }
              : x,
          );
          const sess = sessions.find((x) => x.id === sessionId);
          if (sess) persistMeta(sess);
          return { sessions };
        }),

      newSession: (track) => {
        const id = uid();
        const session: Session = {
          id,
          title: NEW_CHAT_TITLE,
          messages: [],
          connectionId: get().activeConnectionId,
          model: get().activeModel,
          projectId: get().activeProjectId,
          track: track ?? (get().agentMode ? "agent" : "chat"),
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({
          sessions: [session, ...s.sessions],
          activeSessionId: id,
          agentMode: session.track === "agent",
        }));
        persistMeta(session);
        return id;
      },

      // Selecting a conversation restores everything about it: its track, and
      // the model that was talking. Otherwise you return to a discussion held
      // with one model and continue it, unannounced, with another.
      selectSession: (id) =>
        set((s) => {
          const sess = s.sessions.find((x) => x.id === id);
          if (!sess) return { activeSessionId: id };
          return {
            activeSessionId: id,
            agentMode: sess.track !== "chat",
            activeConnectionId: sess.connectionId ?? s.activeConnectionId,
            activeModel: sess.model ?? s.activeModel,
          };
        }),

      switchTrack: (track) => {
        const st = get();
        const current = st.sessions.find((x) => x.id === st.activeSessionId);
        if (current?.track === track) {
          set({ agentMode: track === "agent" });
          return;
        }

        // Prefer this project's most recent conversation on that track — the
        // discussion you were having is the one you want back, not a blank one.
        const mine = st.sessions.find(
          (x) =>
            (x.track ?? "agent") === track &&
            (!st.activeProjectId || x.projectId === st.activeProjectId),
        );
        if (mine) {
          get().selectSession(mine.id);
          return;
        }
        get().newSession(track);
      },

      deleteSession: (id) => {
        void db.deleteSession(id).catch(() => {});
        set((s) => {
          const sessions = s.sessions.filter((x) => x.id !== id);
          return {
            sessions,
            activeSessionId:
              s.activeSessionId === id ? sessions[0]?.id : s.activeSessionId,
          };
        });
      },

      renameSession: (id, title) =>
        set((s) => {
          const sessions = s.sessions.map((x) =>
            x.id === id ? { ...x, title, updatedAt: now() } : x,
          );
          const sess = sessions.find((x) => x.id === id);
          if (sess) persistMeta(sess);
          return { sessions };
        }),

      addMessage: (sessionId, m) => {
        const id = uid();
        const createdAt = now();
        let touched: Session | undefined;
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const messages = [...sess.messages, { ...m, id, createdAt }];
            const title =
              sess.title === NEW_CHAT_TITLE && m.role === "user"
                ? m.content.slice(0, 48) || NEW_CHAT_TITLE
                : sess.title;
            touched = { ...sess, messages, title, updatedAt: createdAt };
            return touched;
          }),
        }));
        if (touched) {
          persistMeta(touched);
          // Persist non-empty messages right away; empty assistant placeholders
          // get written when their stream completes (see persistMessage).
          if (m.content)
            void db
              .upsertMessage({
                id,
                sessionId,
                role: m.role,
                content: m.content,
                model: m.model ?? null,
                createdAt,
              })
              .catch(() => {});
        }
        return id;
      },

      appendToMessage: (sessionId, messageId, delta) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId
              ? sess
              : {
                  ...sess,
                  messages: sess.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + delta }
                      : msg,
                  ),
                },
          ),
        })),

      editMessage: (sessionId, messageId, content) => {
        const sess = get().sessions.find((x) => x.id === sessionId);
        if (!sess) return [];
        const idx = sess.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return sess.messages;

        const kept = sess.messages.slice(0, idx);
        const edited: ChatMessage = {
          ...sess.messages[idx],
          content,
          // Reasoning and cost belonged to the old exchange.
          reasoning: undefined,
          usage: undefined,
          durationMs: undefined,
          thinkingMs: undefined,
        };
        const messages = [...kept, edited];

        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, messages, updatedAt: now() } : x,
          ),
        }));

        // Mirror the truncation into the canon, then rewrite the edited row.
        void db
          .deleteMessagesFrom(sessionId, messageId)
          .then(() =>
            db.upsertMessage({
              id: edited.id,
              sessionId,
              role: edited.role,
              content: edited.content,
              model: edited.model ?? null,
              createdAt: edited.createdAt,
            }),
          )
          .catch(() => {});

        return messages;
      },

      appendReasoning: (sessionId, messageId, delta) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId
              ? sess
              : {
                  ...sess,
                  messages: sess.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, reasoning: (msg.reasoning ?? "") + delta }
                      : msg,
                  ),
                },
          ),
        })),

      setMessageMeta: (sessionId, messageId, meta) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId
              ? sess
              : {
                  ...sess,
                  messages: sess.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, ...meta, usage: { ...msg.usage, ...meta.usage } }
                      : msg,
                  ),
                },
          ),
        })),

      setMessageContent: (sessionId, messageId, content) => {
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId
              ? sess
              : {
                  ...sess,
                  messages: sess.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, content } : msg,
                  ),
                },
          ),
        }));
        get().persistMessage(sessionId, messageId);
      },

      runningTool: undefined,
      setRunningTool: (runningTool) => set({ runningTool }),

      agentRunning: false,
      setAgentRunning: (v) => set({ agentRunning: v }),

      subagents: {},
      setSubagent: (id, patch) =>
        set((s) => {
          const prev = s.subagents[id];
          const next = { ...(prev ?? {}), ...patch, id } as import("./types").SubagentRun;
          return { subagents: { ...s.subagents, [id]: next } };
        }),
      clearSubagents: () => set({ subagents: {} }),

      agentInterjections: [],
      pushAgentInterjection: (text) =>
        set((s) => ({ agentInterjections: [...s.agentInterjections, text] })),
      clearAgentInterjections: () => set({ agentInterjections: [] }),

      agentTrace: {},
      pushAgentEvent: (messageId, e) =>
        set((s) => {
          const prev = s.agentTrace[messageId] ?? [];
          // A second event for the same call id replaces the running placeholder.
          const idx = prev.findIndex((x) => x.id === e.id);
          const next = idx >= 0 ? prev.map((x, i) => (i === idx ? e : x)) : [...prev, e];
          return { agentTrace: { ...s.agentTrace, [messageId]: next } };
        }),
      clearAgentTrace: (messageId) =>
        set((s) => {
          const { [messageId]: _drop, ...rest } = s.agentTrace;
          return { agentTrace: rest };
        }),

      setLastError: (e) => set({ lastError: e }),

      modelStatus: {},
      modelTools: {},
      setModelTools: (connectionId, model, mode) =>
        set((s) => ({
          modelTools: { ...s.modelTools, [`${connectionId}::${model}`]: mode },
        })),
      clearModelTools: (connectionId, model) =>
        set((s) => {
          const next = { ...s.modelTools };
          delete next[`${connectionId}::${model}`];
          return { modelTools: next };
        }),
      setModelStatus: (connectionId, model, status) =>
        set((s) => ({
          modelStatus: { ...s.modelStatus, [`${connectionId}::${model}`]: status },
        })),

      setMemoryError: (e) => set({ memoryError: e }),

      setLastContext: (c) => set({ lastContext: c }),

      trustCommands: false,
      setTrustCommands: (v) => set({ trustCommands: v }),

      requestPrompt: (text) => set({ pendingPrompt: text, agentPanelOpen: true }),
      consumePrompt: () => {
        const p = get().pendingPrompt;
        if (p) set({ pendingPrompt: undefined });
        return p;
      },

      persistMessage: (sessionId, messageId) => {
        const sess = get().sessions.find((x) => x.id === sessionId);
        const msg = sess?.messages.find((m) => m.id === messageId);
        if (!msg) return;
        void db
          .upsertMessage({
            id: msg.id,
            sessionId,
            role: msg.role,
            content: msg.content,
            model: msg.model ?? null,
            createdAt: msg.createdAt,
          })
          .catch(() => {});
      },
    }),
    {
      name: "magnetar-store",
      // Canon (sessions) + connections live in SQLite; models re-warm at startup.
      // Keep only small, non-critical preferences in localStorage.
      partialize: (s) => ({
        activeConnectionId: s.activeConnectionId,
        activeModel: s.activeModel,
        adaptive: s.adaptive,
        agentMode: s.agentMode,
        workspaceRoot: s.workspaceRoot,
        recentFolders: s.recentFolders,
        prefs: s.prefs,
        modelStatus: s.modelStatus,
        modelTools: s.modelTools,
        lang: s.lang,
        theme: s.theme,
        hintsOn: s.hintsOn,
        subsSafariUa: s.subsSafariUa,
        activeProjectId: s.activeProjectId,
        onboarded: s.onboarded,
        sidePanel: s.sidePanel,
        sidebarOpen: s.sidebarOpen,
        agentPanelOpen: s.agentPanelOpen,
        terminalOpen: s.terminalOpen,
        tabs: s.tabs,
        activeTabPath: s.activeTabPath,
        memoryLog: s.memoryLog.slice(0, 30),
      }),
    },
  ),
);
