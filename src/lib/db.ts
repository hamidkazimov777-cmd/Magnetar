import { invoke } from "@tauri-apps/api/core";

/** Wire shapes for the canon commands (Rust serde camelCase). */
export interface SessionMetaRow {
  id: string;
  title: string;
  connectionId: string | null;
  model: string | null;
  summary: string | null;
  summaryUpToId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  model: string | null;
  createdAt: number;
}

export const db = {
  listSessions: () => invoke<SessionMetaRow[]>("list_sessions"),
  loadMessages: (sessionId: string) =>
    invoke<MessageRow[]>("load_messages", { sessionId }),
  saveSession: (meta: SessionMetaRow) => invoke<void>("save_session", { meta }),
  upsertMessage: (message: MessageRow) =>
    invoke<void>("upsert_message", { message }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
};
