export type ProviderKind = "openai_compat" | "gigachat" | "custom";

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
  createdAt: number;
  updatedAt: number;
}

/** Stream events mirrored from the Rust `StreamEvent` enum. */
export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; finish_reason?: string | null }
  | { type: "error"; message: string };

/** Preset base URLs for the "add connection" form. */
export const OPENAI_COMPAT_PRESETS: { name: string; baseUrl: string }[] = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Together", baseUrl: "https://api.together.xyz/v1" },
  { name: "Local (LM Studio)", baseUrl: "http://localhost:1234/v1" },
];
