import { db } from "../db";
import { reportPromise } from "../errors";
import { providerForBaseUrl } from "../generation";
import type { ChatMessage, Session, Track } from "../types";
import { NEW_CHAT_TITLE, now, persistMeta, uid, type CenterView } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   CONVERSATIONS AND THE CANON

   Sessions are the canon: provider-neutral transcripts that outlive whichever
   model produced them. Everything here writes memory first and SQLite in the
   background, because chat must never block on disk.

   A track (discussion / agent / generation) is a property of the conversation,
   not of the window. Switching tracks therefore switches conversations, and
   with them the model — otherwise you return to a discussion held with one
   model and continue it, unannounced, with another.
   ========================================================================== */

export interface SessionsSlice {
  sessions: Session[];
  activeSessionId?: string;
  hydrated: boolean;

  /** Mirror of the active conversation's track, kept for the UI. The truth is
   *  the session's own `track`. */
  activeTrack: Track;
  /** Move to a track, adopting (or starting) that track's conversation. */
  switchTrack: (track: Track) => void;
  /** Toggle whether the active conversation sees the project (memory, root,
   *  facts, decisions). */
  toggleProjectContext: () => void;

  attachSessionToProject: (sessionId: string, projectId: string) => void;
  setSummary: (sessionId: string, summary: string, upToId: string) => void;

  newSession: (track?: Track) => string;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  addMessage: (sessionId: string, m: Omit<ChatMessage, "id" | "createdAt">) => string;
  appendToMessage: (sessionId: string, messageId: string, delta: string) => void;
  setMessageContent: (sessionId: string, messageId: string, content: string) => void;
  /** Attach produced assets (e.g. generated images) to a finished message.
   *  In-memory only — attachments are ephemeral, like pasted images. */
  setMessageAttachments: (
    sessionId: string,
    messageId: string,
    attachments: ChatMessage["attachments"],
  ) => void;
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
}

export const createSessionsSlice: Slice<SessionsSlice> = (set, get) => ({
  sessions: [],
  hydrated: false,
  activeTrack: "chat",

  attachSessionToProject: (sessionId: string, projectId: string) =>
    set((s) => {
      const sessions = s.sessions.map((x) =>
        x.id === sessionId ? { ...x, projectId, updatedAt: Date.now() } : x,
      );
      const sess = sessions.find((x) => x.id === sessionId);
      if (sess) persistMeta(sess);
      return { sessions };
    }),

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
    const st = get();
    const resolvedTrack = track ?? st.activeTrack;
    // A generative conversation runs on a generative provider; a fresh one
    // must not inherit the text model the user was just talking to.
    const genConn =
      resolvedTrack === "generation"
        ? st.connections.find((c) => c.kind === "generative")
        : undefined;
    const session: Session = {
      id,
      title: NEW_CHAT_TITLE,
      messages: [],
      connectionId: resolvedTrack === "generation" ? genConn?.id : st.activeConnectionId,
      model:
        resolvedTrack === "generation"
          ? (genConn ? providerForBaseUrl(genConn.baseUrl)?.models[0] : undefined)
          : st.activeModel,
      projectId: st.activeProjectId,
      track: resolvedTrack,
      createdAt: now(),
      updatedAt: now(),
    };
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      activeTrack: resolvedTrack,
      activeConnectionId: session.connectionId,
      activeModel: session.model,
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
      // Helper rows belong to the run that produced them; carrying them
      // into another conversation makes them look like live work there.
      if (!sess) return { activeSessionId: id, subagents: {} };
      // A generative conversation must not fall back to the text model the
      // user was just on — the two tracks use different provider kinds.
      return {
        activeSessionId: id,
        subagents: {},
        activeTrack: sess.track ?? "chat",
        activeConnectionId:
          sess.track === "generation"
            ? sess.connectionId
            : (sess.connectionId ?? s.activeConnectionId),
        activeModel:
          sess.track === "generation"
            ? sess.model
            : (sess.model ?? s.activeModel),
      };
    }),

  switchTrack: (track) => {
    const st = get();
    // The centre follows the mode: generation is a full-screen studio; the
    // text tracks (discussion / agent) work over the editor. Leaving the
    // studio returns to the editor; other center views (settings, projects)
    // are left as-is.
    const centerView: CenterView =
      track === "generation"
        ? "studio"
        : st.centerView === "studio"
          ? "editor"
          : st.centerView;
    set({ centerView });
    const current = st.sessions.find((x) => x.id === st.activeSessionId);
    if (current?.track === track) {
      set({ activeTrack: track });
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

  toggleProjectContext: () => {
    const st = get();
    const sess = st.sessions.find((x) => x.id === st.activeSessionId);
    if (!sess) return;
    const next = {
      ...sess,
      seesProject: !(sess.seesProject ?? true),
      updatedAt: now(),
    };
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === next.id ? next : x)),
    }));
    persistMeta(next);
  },

  deleteSession: (id) => {
    void reportPromise(db.deleteSession(id), "db:delete_session");
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
        void reportPromise(
          db.upsertMessage({
            id,
            sessionId,
            role: m.role,
            content: m.content,
            model: m.model ?? null,
            createdAt,
          }),
          "db:upsert_message",
        );
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
    void reportPromise(
      db.deleteMessagesFrom(sessionId, messageId).then(() =>
        db.upsertMessage({
          id: edited.id,
          sessionId,
          role: edited.role,
          content: edited.content,
          model: edited.model ?? null,
          createdAt: edited.createdAt,
        }),
      ),
      "db:edit_message",
    );

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

  setMessageAttachments: (sessionId, messageId, attachments) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              messages: sess.messages.map((msg) =>
                msg.id === messageId ? { ...msg, attachments } : msg,
              ),
            },
      ),
    })),

  persistMessage: (sessionId, messageId) => {
    const sess = get().sessions.find((x) => x.id === sessionId);
    const msg = sess?.messages.find((m) => m.id === messageId);
    if (!msg) return;
    void reportPromise(
      db.upsertMessage({
        id: msg.id,
        sessionId,
        role: msg.role,
        content: msg.content,
        model: msg.model ?? null,
        createdAt: msg.createdAt,
      }),
      "db:persist_message",
    );
  },
});
