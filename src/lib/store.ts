import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, Connection, ModelInfo, Session } from "./types";

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

const now = () => Date.now();

interface State {
  connections: Connection[];
  activeConnectionId?: string;
  activeModel?: string;

  /** Cached model catalog per connection (for the adaptive router). */
  models: Record<string, ModelInfo[]>;

  /** Adaptive mode: let Magnetar pick/suggest the right-sized model per prompt. */
  adaptive: boolean;

  sessions: Session[];
  activeSessionId?: string;

  // connections
  addConnection: (c: Omit<Connection, "id">) => string;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  setActiveModel: (model: string) => void;
  setModels: (connectionId: string, models: ModelInfo[]) => void;
  setActive: (connectionId: string, model: string) => void;
  setAdaptive: (on: boolean) => void;

  // handoff
  setSummary: (sessionId: string, summary: string, upToId: string) => void;

  // sessions
  newSession: () => string;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // messages
  addMessage: (sessionId: string, m: Omit<ChatMessage, "id" | "createdAt">) => string;
  appendToMessage: (sessionId: string, messageId: string, delta: string) => void;
  setMessageContent: (sessionId: string, messageId: string, content: string) => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      connections: [],
      models: {},
      adaptive: false,
      sessions: [],

      setModels: (connectionId, models) =>
        set((s) => ({ models: { ...s.models, [connectionId]: models } })),

      setActive: (connectionId, model) =>
        set({ activeConnectionId: connectionId, activeModel: model }),

      setAdaptive: (on) => set({ adaptive: on }),

      setSummary: (sessionId, summary, upToId) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, summary, summaryUpToId: upToId } : x,
          ),
        })),

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

      newSession: () => {
        const id = uid();
        const session: Session = {
          id,
          title: "New chat",
          messages: [],
          connectionId: get().activeConnectionId,
          model: get().activeModel,
          createdAt: now(),
          updatedAt: now(),
        };
        set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: id }));
        return id;
      },

      selectSession: (id) => set({ activeSessionId: id }),

      deleteSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((x) => x.id !== id);
          return {
            sessions,
            activeSessionId:
              s.activeSessionId === id ? sessions[0]?.id : s.activeSessionId,
          };
        }),

      renameSession: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, title, updatedAt: now() } : x,
          ),
        })),

      addMessage: (sessionId, m) => {
        const id = uid();
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const messages = [...sess.messages, { ...m, id, createdAt: now() }];
            // Derive a title from the first user message.
            const title =
              sess.title === "New chat" && m.role === "user"
                ? m.content.slice(0, 48) || "New chat"
                : sess.title;
            return { ...sess, messages, title, updatedAt: now() };
          }),
        }));
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

      setMessageContent: (sessionId, messageId, content) =>
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
        })),
    }),
    {
      name: "magnetar-store",
      partialize: (s) => ({
        connections: s.connections,
        activeConnectionId: s.activeConnectionId,
        activeModel: s.activeModel,
        adaptive: s.adaptive,
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
      }),
    },
  ),
);
