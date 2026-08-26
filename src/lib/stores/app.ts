import { db } from "../db";
import { reportError, reportPromise } from "../errors";
import type { ChatMessage, Connection, Session } from "../types";
import type { Slice } from "./state";

/* ==========================================================================
   STARTUP

   One pass that fills the store from SQLite, and the one banner that says it
   did not work. Reading saved data must never stop the app from opening: a
   failed hydrate starts empty and says so, rather than showing a blank window
   with no explanation.
   ========================================================================== */

export interface AppSlice {
  hydrate: () => Promise<void>;
  /** Startup failure: saved data could not be read. Shown once as a dismissible
   *  banner; the app still starts empty instead of blocking. */
  startupError?: string;
  setStartupError: (msg: string | undefined) => void;
}

export const createAppSlice: Slice<AppSlice> = (set, get) => ({
  setStartupError: (msg) => set({ startupError: msg }),

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
          void reportPromise(
            db.saveConnection({
              id: c.id,
              name: c.name,
              kind: c.kind,
              baseUrl: c.baseUrl,
              scope: c.scope ?? null,
              caPath: c.caPath ?? null,
              createdAt: Date.now(),
            }),
            "db:migrate_connection",
          );
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
            // Pre-flag chats keep seeing the project (old behaviour).
            seesProject: m.seesProject ?? true,
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
      set((s) => {
        const activeId = s.activeSessionId ?? sessions[0]?.id;
        return {
          sessions,
          activeSessionId: activeId,
          activeTrack: sessions.find((x) => x.id === activeId)?.track ?? "chat",
          hydrated: true,
        };
      });
    } catch (e) {
      set({ hydrated: true, startupError: reportError(e, "db:hydrate").message });
    }
  },
});
