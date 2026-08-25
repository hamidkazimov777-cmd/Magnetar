/** AI Generation Hub — a catalogue of generative providers and the shapes the
 *  frontend uses to talk to them.
 *
 *  Generation is deliberately separate from the chat provider system: the API
 *  key still lives in the same secret store (keyed by `id`), but nothing here
 *  touches `store.connections` or SQLite, so the chat / agent / project
 *  surfaces cannot be affected by this feature. */

export type GenCategory = "image" | "video" | "audio" | "voice";

export interface GenProvider {
  /** Secret-store id. Reuses `save_api_key` / `has_api_key` as-is. */
  id: string;
  name: string;
  category: GenCategory;
  /** Accent colour for the catalogue card. */
  color: string;
  /** true = generation actually works today (OpenAI-compatible images). */
  available: boolean;
  /** OpenAI-compatible base URL (available providers only). */
  baseUrl?: string;
  /** "b64_json" for OpenAI-shaped endpoints; null for providers that return
   *  URLs instead. Only meaningful when `available`. */
  responseFormat?: string | null;
  /** Static model list — a fallback when the provider's /models has no obvious
   *  image models. */
  models?: string[];
  sizes?: string[];
  note?: string;
}

/** One generated asset, as returned by `generate_image`. At least one of
 *  `url` / `b64` is set. */
export interface GeneratedImage {
  url?: string | null;
  b64?: string | null;
}

export const GEN_CATEGORIES: { id: GenCategory; order: number }[] = [
  { id: "image", order: 0 },
  { id: "video", order: 1 },
  { id: "audio", order: 2 },
  { id: "voice", order: 3 },
];

export const GEN_PROVIDERS: GenProvider[] = [
  // ---- Images · available (OpenAI-compatible) ----
  {
    id: "gen:openai-image",
    name: "OpenAI Images",
    category: "image",
    color: "#10a37f",
    available: true,
    baseUrl: "https://api.openai.com/v1",
    responseFormat: "b64_json",
    models: ["dall-e-3", "dall-e-2", "gpt-image-1"],
    sizes: ["1024x1024", "1792x1024", "1024x1792", "512x512"],
  },
  {
    id: "gen:together-image",
    name: "Together AI",
    category: "image",
    color: "#7c3aed",
    available: true,
    baseUrl: "https://api.together.xyz/v1",
    responseFormat: null,
    models: [
      "black-forest-labs/FLUX.1-schnell",
      "black-forest-labs/FLUX.1-dev",
      "stabilityai/stable-diffusion-xl-base-1.0",
    ],
    sizes: ["1024x1024", "768x1024", "1024x768", "512x512"],
  },

  // ---- Images · coming soon ----
  { id: "gen:midjourney", name: "Midjourney", category: "image", color: "#0f172a", available: false },
  { id: "gen:ideogram", name: "Ideogram", category: "image", color: "#e11d48", available: false },
  { id: "gen:flux-bfl", name: "Flux (BFL)", category: "image", color: "#f59e0b", available: false },
  { id: "gen:recraft", name: "Recraft", category: "image", color: "#0ea5e9", available: false },
  { id: "gen:leonardo", name: "Leonardo", category: "image", color: "#d946ef", available: false },
  { id: "gen:nanobanana", name: "nanobanana", category: "image", color: "#facc15", available: false },

  // ---- Video · coming soon ----
  { id: "gen:veo", name: "Veo (Google)", category: "video", color: "#4285f4", available: false },
  { id: "gen:kling", name: "Kling", category: "video", color: "#22c55e", available: false },
  { id: "gen:runway", name: "Runway", category: "video", color: "#64748b", available: false },
  { id: "gen:pika", name: "Pika", category: "video", color: "#f97316", available: false },
  { id: "gen:luma", name: "Luma Dream Machine", category: "video", color: "#a855f7", available: false },
  { id: "gen:seedance", name: "seedance", category: "video", color: "#06b6d4", available: false },

  // ---- Audio · coming soon ----
  { id: "gen:suno", name: "Suno", category: "audio", color: "#ef4444", available: false },
  { id: "gen:udio", name: "Udio", category: "audio", color: "#8b5cf6", available: false },
  { id: "gen:stable-audio", name: "Stable Audio", category: "audio", color: "#14b8a6", available: false },

  // ---- Voice · coming soon ----
  { id: "gen:elevenlabs", name: "ElevenLabs", category: "voice", color: "#4f46e5", available: false },
  { id: "gen:openai-tts", name: "OpenAI TTS", category: "voice", color: "#10a37f", available: false },
  { id: "gen:playht", name: "PlayHT", category: "voice", color: "#0891b2", available: false },
  { id: "gen:murf", name: "Murf", category: "voice", color: "#db2777", available: false },
];
