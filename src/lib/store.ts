import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, type SessionMetaRow } from "./db";
import type { Lang } from "./i18n";
import type { ChatMessage, Connection, ModelInfo, Session } from "./types";

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
  agentMode: boolean;
  setAgentMode: (on: boolean) => void;
  workspaceRoot?: string;
  setWorkspaceRoot: (path: string | undefined) => void;
  lang: Lang;
  setLang: (lang: Lang) => void;

  sessions: Session[];
  activeSessionId?: string;
  hydrated: boolean;

  projects: import("./types").Project[];
  activeProjectId?: string;

  loadProjects: () => Promise<void>;
  setActiveProject: (id: string | undefined) => void;
  addProject: (p: import("./types").Project) => void;
  updateProject: (p: import("./types").Project) => void;
  deleteProject: (id: string) => void;

  hydrate: () => Promise<void>;

  addConnection: (c: Omit<Connection, "id">) => string;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  setActiveModel: (model: string) => void;
  setModels: (connectionId: string, models: ModelInfo[]) => void;
  setActive: (connectionId: string, model: string) => void;
  setAdaptive: (on: boolean) => void;

  setSummary: (sessionId: string, summary: string, upToId: string) => void;

  newSession: () => string;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  addMessage: (sessionId: string, m: Omit<ChatMessage, "id" | "createdAt">) => string;
  appendToMessage: (sessionId: string, messageId: string, delta: string) => void;
  setMessageContent: (sessionId: string, messageId: string, content: string) => void;
  /** Persist a message's current in-memory content to the DB (e.g. after a stream ends). */
  persistMessage: (sessionId: string, messageId: string) => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      connections: [],
      models: {},
      adaptive: false,
      agentMode: false,
      setAgentMode: (on) => set({ agentMode: on }),
      setWorkspaceRoot: (path) => set({ workspaceRoot: path }),
      lang: "ru",
      setLang: (lang) => set({ lang }),
      sessions: [],
      projects: [],
      hydrated: false,

      hydrate: async () => {
        try {
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

      loadProjects: async () => {
        const projects = await db.listProjects();
        set({ projects });
      },

      setActiveProject: (id) => set({ activeProjectId: id }),

      addProject: (p) => {
        void db.saveProject(p).catch(() => {});
        set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id }));
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

      setModels: (connectionId, models) =>
        set((s) => ({ models: { ...s.models, [connectionId]: models } })),

      setActive: (connectionId, model) =>
        set({ activeConnectionId: connectionId, activeModel: model }),

      setAdaptive: (on) => set({ adaptive: on }),

      addConnection: (c) => {
        const id = uid();
        set((s) => ({
          connections: [...s.connections, { ...c, id }],
          activeConnectionId: s.activeConnectionId ?? id,
        }));
        return id;
      },

      removeConnection: (id) =>
        set((s) => {
          const connections = s.connections.filter((c) => c.id !== id);
          return {
            connections,
            activeConnectionId:
              s.activeConnectionId === id ? connections[0]?.id : s.activeConnectionId,
            activeModel: s.activeConnectionId === id ? undefined : s.activeModel,
          };
        }),

      setActiveConnection: (id) =>
        set({ activeConnectionId: id, activeModel: undefined }),

      setActiveModel: (model) => set({ activeModel: model }),

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

      newSession: () => {
        const id = uid();
        const session: Session = {
          id,
          title: "New chat",
          messages: [],
          connectionId: get().activeConnectionId,
          model: get().activeModel,
          projectId: get().activeProjectId,
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: id }));
        persistMeta(session);
        return id;
      },

      selectSession: (id) => set({ activeSessionId: id }),

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
              sess.title === "New chat" && m.role === "user"
                ? m.content.slice(0, 48) || "New chat"
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
      // Canon (sessions) is in SQLite; only keep light preferences here.
      partialize: (s) => ({
        connections: s.connections,
        activeConnectionId: s.activeConnectionId,
        activeModel: s.activeModel,
        adaptive: s.adaptive,
        agentMode: s.agentMode,
        workspaceRoot: s.workspaceRoot,
        lang: s.lang,
        activeProjectId: s.activeProjectId,
      }),
    },
  ),
);
