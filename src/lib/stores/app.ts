import { db, type AgentRunRow } from "../db";
import { reportError, reportPromise } from "../errors";
import type { Connection, Session } from "../types";
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
  /** Runs that were in flight when the app last closed — reconciled to
   *  "interrupted" at startup and offered to the user to review or clear. */
  interruptedRuns: AgentRunRow[];
  dismissInterruptedRuns: () => void;
}

export const createAppSlice: Slice<AppSlice> = (set, get) => ({
  setStartupError: (msg) => set({ startupError: msg }),
  interruptedRuns: [],
  dismissInterruptedRuns: () => set({ interruptedRuns: [] }),

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
      // Only the metadata is read here. The messages of a conversation load
      // when it is first opened (see ensureMessages), so launching the app does
      // not read every message of every conversation ever held.
      const sessions: Session[] = metas.map((m) => ({
        id: m.id,
        title: m.title,
        connectionId: m.connectionId ?? undefined,
        model: m.model ?? undefined,
        summary: m.summary ?? undefined,
        summaryUpToId: m.summaryUpToId ?? undefined,
        projectId: m.projectId ?? undefined,
        // Conversations that predate tracks are agent chats: that is all
        // Magnetar had, and every one of them was tool-enabled.
        track: (m.track as Session["track"]) ?? "agent",
        seesProject: m.seesProject ?? true,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        messages: [],
        messagesLoaded: false,
      }));
      set((s) => {
        const activeId = s.activeSessionId ?? sessions[0]?.id;
        // The one open conversation loads its messages now; the rest wait until
        // opened.
        if (activeId) void get().ensureMessages(activeId);
        return {
          sessions,
          activeSessionId: activeId,
          activeTrack: sessions.find((x) => x.id === activeId)?.track ?? "chat",
          hydrated: true,
        };
      });
      // The workspace root is restored from localStorage, but the backend only
      // hears about it through a user action — so without this a restart left
      // path containment and repository trust switched off.
      await get().adoptRestoredWorkspace();

      // Any run still marked in-flight belongs to a process that no longer
      // exists — mark them interrupted so the record is honest, and surface the
      // ones just reconciled so the user knows work was cut off by a restart.
      const fixed = await db.reconcileAgentRuns().catch(() => 0);
      if (fixed > 0) {
        const recent = await db.listAgentRuns(undefined, 100).catch(() => []);
        set({ interruptedRuns: recent.filter((r) => r.status === "interrupted").slice(0, 10) });
      }
    } catch (e) {
      set({ hydrated: true, startupError: reportError(e, "db:hydrate").message });
    }
  },
});
