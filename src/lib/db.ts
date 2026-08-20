import { invoke } from "@tauri-apps/api/core";

/** Wire shapes for the canon commands (Rust serde camelCase). */
export interface SessionMetaRow {
  id: string;
  title: string;
  connectionId: string | null;
  model: string | null;
  summary: string | null;
  summaryUpToId: string | null;
  projectId: string | null;
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

export interface ConnectionRow {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  scope: string | null;
  caPath: string | null;
  createdAt: number;
}

export const db = {
  listConnections: () => invoke<ConnectionRow[]>("list_connections"),
  saveConnection: (connection: ConnectionRow) =>
    invoke<void>("save_connection", { connection }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),

  listSessions: () => invoke<SessionMetaRow[]>("list_sessions"),
  loadMessages: (sessionId: string) =>
    invoke<MessageRow[]>("load_messages", { sessionId }),
  saveSession: (meta: SessionMetaRow) => invoke<void>("save_session", { meta }),
  upsertMessage: (message: MessageRow) =>
    invoke<void>("upsert_message", { message }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  /** Drop a message and everything after it — used when a turn is edited. */
  deleteMessagesFrom: (sessionId: string, messageId: string) =>
    invoke<void>("delete_messages_from", { sessionId, messageId }),

  // Workspace
  listProjects: () => invoke<import("./types").Project[]>("list_projects"),
  saveProject: (project: import("./types").Project) => invoke<void>("save_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  listFacts: (projectId: string) =>
    invoke<import("./types").MemoryFact[]>("list_facts", { projectId }),
  saveFacts: (facts: import("./types").MemoryFact[]) => invoke<void>("save_facts", { facts }),
  deleteFact: (id: string) => invoke<void>("delete_fact", { id }),

  listDecisions: (projectId: string) =>
    invoke<import("./types").Decision[]>("list_decisions", { projectId }),
  saveDecision: (decision: import("./types").Decision) =>
    invoke<void>("save_decision", { decision }),
  deleteDecision: (id: string) => invoke<void>("delete_decision", { id }),

  listTasks: (projectId: string) => invoke<import("./types").Task[]>("list_tasks", { projectId }),
  saveTask: (task: import("./types").Task) => invoke<void>("save_task", { task }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  listKnowledgeNodes: (projectId: string) => invoke<import("./types").KnowledgeNode[]>("list_knowledge_nodes", { projectId }),
  saveKnowledgeNode: (node: import("./types").KnowledgeNode) => invoke<void>("save_knowledge_node", { node }),

  listKnowledgeEdges: (projectId: string) => invoke<import("./types").KnowledgeEdge[]>("list_knowledge_edges", { projectId }),
  saveKnowledgeEdge: (edge: import("./types").KnowledgeEdge) => invoke<void>("save_knowledge_edge", { edge }),

  listTimelineEvents: (projectId: string) => invoke<import("./types").TimelineEvent[]>("list_timeline_events", { projectId }),
  saveTimelineEvent: (event: import("./types").TimelineEvent) => invoke<void>("save_timeline_event", { event }),
};
