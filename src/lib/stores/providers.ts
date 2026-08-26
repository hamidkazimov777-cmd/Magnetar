import { db } from "../db";
import { reportPromise } from "../errors";
import type { Connection, ModelInfo } from "../types";
import { now, persistMeta, uid } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   PROVIDERS AND MODELS

   Which endpoints are configured, which one is talking, and what each model
   turned out to actually support. The last part is learned rather than
   declared: providers accept a `tools` array and then ignore it, and a token
   that cannot call a catalogue entry only says so at call time.
   ========================================================================== */

export interface ProvidersSlice {
  connections: Connection[];
  activeConnectionId?: string;
  activeModel?: string;
  models: Record<string, ModelInfo[]>;
  adaptive: boolean;

  addConnection: (c: Omit<Connection, "id">) => string;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  setActiveModel: (model: string) => void;
  setModels: (connectionId: string, models: ModelInfo[]) => void;
  setActive: (connectionId: string, model: string) => void;
  setAdaptive: (on: boolean) => void;

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
}

export const createProvidersSlice: Slice<ProvidersSlice> = (set, get) => ({
  connections: [],
  models: {},
  adaptive: false,

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
    void reportPromise(
      db.saveConnection({
        id,
        name: c.name,
        kind: c.kind,
        baseUrl: c.baseUrl,
        scope: c.scope ?? null,
        caPath: c.caPath ?? null,
        createdAt: Date.now(),
      }),
      "db:save_connection",
    );
    return id;
  },

  removeConnection: (id) => {
    void reportPromise(db.deleteConnection(id), "db:delete_connection");
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
});
