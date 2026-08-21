export type ProviderKind = "openai_compat" | "gigachat" | "anthropic" | "custom";

/** A configured provider endpoint. The API key lives in `secrets.json` (app
 *  data dir, 0600) — not in the Keychain since Entry 44 — keyed by
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
  /** Which track this conversation belongs to.
   *
   *  "agent" has tools and changes the project; "chat" is for talking a task
   *  through — no tools, no edits. They are separate conversations on purpose:
   *  in one transcript the discussion and the tool steps mix together, and an
   *  hour later nobody can find where something was agreed. Each track carries
   *  its own model, so switching tracks switches models with nothing to
   *  remember. */
  track?: "agent" | "chat";
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
  /** When the prose fields above were split into facts. Undefined = not yet.
   *  The fields stay in the DB as a safety net, but stop reaching the model. */
  factsMigratedAt?: number;
  /** Same, for the old `decisions` text field becoming a decision log. */
  decisionsMigratedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/* --------------------------------------------------------------------------
   MEMORY FACTS

   A fact is what project memory is made of. It is deliberately not a line of
   prose: a coder reading memory has to be able to tell "SQLite — read out of
   the dependencies, confirmed today" from "hexagonal architecture — the user
   said so once, never checked". A false fact is worse than a missing one,
   because it gets trusted.
   -------------------------------------------------------------------------- */

/** Only the sections that actually change what a model generates. */
export type FactKind = "stack" | "architecture" | "constraint" | "state";

export type FactOrigin =
  /** Read out of the project itself (package.json, Cargo.toml, a file). */
  | "extracted"
  /** The user said so. */
  | "user"
  /** A model concluded it from what it saw. */
  | "inferred"
  /** Came from the old free-text memory fields, before facts existed. */
  | "legacy";

export type FactStatus =
  /** Nobody has confirmed it — this is the honest default. */
  | "unverified"
  /** A machine confirmed it at `checkedAt`. */
  | "verified"
  /** It was verified once, but the project has changed since. */
  | "stale"
  /** A machine looked and found the opposite. */
  | "refuted";

/** How a machine can confirm a fact. Anything that reduces to a check should
 *  be executed, not believed: "we use SQLite" is a grep over the dependency
 *  manifests, not an opinion. */
export type VerifySpec =
  /** Look for `pattern` (a regex) inside `file`, relative to the project root. */
  | { kind: "grep"; pattern: string; file: string }
  /** The fact holds while a project check (Problems panel) passes. */
  | { kind: "check"; checkId: string };

/** A decision, recorded when it was made.
 *
 *  This is the part the code cannot tell you later. In six months the
 *  architecture is readable from the files; why it was chosen, and what was
 *  rejected on the way, exists only if someone wrote it down at the time. */
export interface Decision {
  id: string;
  projectId: string;
  title: string;
  /** Why this, in one or two sentences. */
  rationale?: string;
  /** What was considered and turned down, and why. */
  alternatives?: string;
  /** JSON array of paths the decision touches. */
  files?: string;
  /** The commit the project stood at when this was decided. */
  commitSha?: string;
  origin: "user" | "agent" | "legacy";
  createdAt: number;
}

/** A contradiction between memory and the project, waiting to be reviewed.
 *
 *  Queued deliberately: a model that finds memory wrong mid-task leaves a note
 *  and keeps going. Interrupting the work to confirm each one is how
 *  confirmation fatigue starts, and confirmation fatigue is what made the user
 *  switch approvals off entirely. */
export interface Divergence {
  id: string;
  projectId: string;
  /** The fact this contradicts, when it is about a specific one. */
  factId?: string;
  summary: string;
  /** What the fact should say instead. Empty means "drop it". */
  proposal?: string;
  /** Where it was seen: a path, a line, a quote. */
  evidence?: string;
  source: "agent" | "check";
  status: "open" | "applied" | "dismissed";
  createdAt: number;
  resolvedAt?: number;
}

/** A helper agent's run, as the panel shows it. Transient: this is process,
 *  not canon, so it is never persisted. */
export interface SubagentRun {
  id: string;
  title: string;
  model: string;
  status: "running" | "done" | "failed" | "stopped";
  /** Tool the helper is on right now. */
  tool?: string;
  steps: number;
  startedAt: number;
  /** Why it ended badly. Without this the panel shows a warning triangle and
   *  nothing else, and the reason has to be guessed from the lead's summary. */
  error?: string;
}

export interface MemoryFact {
  id: string;
  projectId: string;
  kind: FactKind;
  text: string;
  origin: FactOrigin;
  /** Which file, which conversation, which model — shown next to the fact. */
  originDetail?: string;
  /** Serialised `VerifySpec`; the DB stores JSON, not a shape. */
  verify?: string;
  status: FactStatus;
  checkedAt?: number;
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
