export type ProviderKind = "openai_compat" | "gigachat" | "anthropic" | "custom";

/** A configured provider endpoint. The API key lives in the Keychain, keyed by
 *  `id` — it is never stored here. */
export interface Connection {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** GigaChat only: OAuth scope (default GIGACHAT_API_PERS). */
  scope?: string;
  /** GigaChat only: path to the Russian Trusted Root CA PEM. */
  caPath?: string;
}

/** GigaChat uses fixed endpoints; base URL is not user-editable. */
export const GIGACHAT_BASE = "https://gigachat.devices.sberbank.ru/api/v1";

/** Claude's native API. Not OpenAI-shaped: x-api-key auth, /v1/messages. */
export const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

/** Moonshot (Kimi) speaks plain OpenAI, so it needs no adapter of its own —
 *  only its own slot in the connection form, because the two regions are
 *  separate services with separate keys and a key from one is rejected by the
 *  other. Global is the default; .cn is for mainland accounts. */
export const KIMI_BASES = {
  global: "https://api.moonshot.ai/v1",
  cn: "https://api.moonshot.cn/v1",
} as const;

export interface ModelInfo {
  id: string;
  label?: string | null;
}

export type Role = "user" | "assistant" | "system";

export interface Attachment {
  id: string;
  type: "image" | "file";
  mimeType: string;
  name: string;
  data?: string; // base64 for images
  path?: string; // for attach_file tool
  extractedText?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Which model produced this message (for cross-model handoff continuity). */
  model?: string;
  attachments?: Attachment[];
  /** The model's own thinking, when it exposes it (Anthropic extended
   *  thinking, DeepSeek/OpenRouter reasoning fields). Kept apart from
   *  `content` on purpose: it is shown collapsed and is never fed back into
   *  the model or into project memory. */
  reasoning?: string;
  /** What the turn cost and how long it took. Undefined when the provider
   *  does not report usage. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Wall-clock milliseconds from request to final token. */
  durationMs?: number;
  /** How much of that was spent producing the reasoning block. */
  thinkingMs?: number;
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** Which connection + model produced/continues this session. */
  connectionId?: string;
  model?: string;
  /** Rolling handoff summary — the compressor that carries context across model
   *  switches and keeps token cost down. */
  summary?: string;
  /** Id of the last message covered by `summary`. */
  summaryUpToId?: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  techStack?: string;
  architectureNotes?: string;
  codingStandards?: string;
  decisions?: string;
  activeGoals?: string;
  roadmap?: string;
  risks?: string;
  /** Filesystem path this project maps to (set by folder onboarding). */
  path?: string;
  /** Rolling "where we stopped" thesis — flushed to memory on model switch. */
  lastState?: string;
  createdAt: number;
  updatedAt: number;
}

/** What kind of memory work produced an entry in the memory log.
 *
 *  Everything that writes to project memory does so in the background, on a
 *  cheap model, from several different triggers. Before this log existed those
 *  writes were invisible: a refused model or a malformed reply left memory
 *  silently empty and the user had no way to tell. Every one of them now
 *  reports here — success and failure alike. */
export type MemoryEventKind =
  | "audit" /** folder analysis → description, stack, architecture, standards */
  | "handoff" /** model switch → "where we stopped" */
  | "decisions" /** transcript mining → key decisions */
  | "graph" /** transcript mining → knowledge graph */
  | "summary" /** rolling conversation summary */
  | "index"; /** code search index build */

export interface MemoryEvent {
  id: string;
  at: number;
  kind: MemoryEventKind;
  status: "ok" | "error" | "skipped";
  /** Either an i18n key (known cases) or a raw provider message. */
  detail?: string;
  projectId?: string;
  model?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | string;
  priority: string;
  owner?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeNode {
  id: string;
  projectId: string;
  title: string;
  nodeType: string;
  summary?: string;
  metadata?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: string;
}

export interface TimelineEvent {
  id: string;
  projectId: string;
  eventType: "Decision" | "TaskCreated" | "TaskCompleted" | "FileChanged" | "ArchitectureUpdate" | "AgentAction" | string;
  content: string;
  createdAt: number;
}

/** Stream events mirrored from the Rust `StreamEvent` enum. */
export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "usage"; inputTokens?: number | null; outputTokens?: number | null }
  | { type: "done"; finish_reason?: string | null }
  | { type: "error"; message: string };

/** Preset base URLs for the "add connection" form. */
export const OPENAI_COMPAT_PRESETS: { name: string; baseUrl: string }[] = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Together", baseUrl: "https://api.together.xyz/v1" },
  { name: "Local (LM Studio)", baseUrl: "http://localhost:1234/v1" },
];
