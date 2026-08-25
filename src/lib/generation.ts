/** Universal generative layer.
 *
 *  `image` is just one `GenerationKind`. The track, the UI and the backend
 *  `generate` command are all modality-agnostic — adding a video/audio/voice
 *  provider means adding a catalog entry here, not refactoring anything else. */

export type GenerationKind = "image" | "video" | "audio" | "voice";

/** Schema of one adjustable parameter rendered in the generation form. */
export interface GenerationParamDef {
  /** JSON key in the request body. */
  key: string;
  /** i18n key for the label. */
  label: string;
  type: "select" | "number" | "text";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
}

/** How a provider is reached and what it generates. */
export interface GenerationProvider {
  id: string;
  name: string;
  kind: GenerationKind;
  /** false = listed as "coming soon", no live calls. */
  available: boolean;
  baseUrl: string;
  authType: "bearer";
  /** Path appended to baseUrl, e.g. "images/generations". */
  endpoint: string;
  method: "POST";
  /** direct = synchronous; poll = async job (reserved for video/audio). */
  strategy?: "direct" | "poll";
  /** Request-level option like b64_json, when the provider needs it. */
  responseFormat?: string | null;
  /** Where output assets live in the response JSON. Default "data". */
  resultPath?: string;
  models: string[];
  params: GenerationParamDef[];
}

/** What to generate (the domain request, independent of any single modality). */
export interface GenerationRequest {
  kind: GenerationKind;
  model: string;
  prompt: string;
  endpoint: string;
  params: Record<string, unknown>;
}

/** One produced asset (a URL or inline base64). */
export interface GenerationAsset {
  url?: string | null;
  b64?: string | null;
  mimeType?: string | null;
}

export interface GenerationResult {
  kind: GenerationKind;
  assets: GenerationAsset[];
}

export const GEN_PROVIDERS: GenerationProvider[] = [
  // ---- image · available ----
  {
    id: "openai-image",
    name: "OpenAI Images",
    kind: "image",
    available: true,
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
    endpoint: "images/generations",
    method: "POST",
    strategy: "direct",
    responseFormat: "b64_json",
    models: ["dall-e-3", "gpt-image-1", "dall-e-2"],
    params: [
      {
        key: "size",
        label: "genParamSize",
        type: "select",
        options: ["1024x1024", "1792x1024", "1024x1792", "512x512"],
        default: "1024x1024",
      },
      { key: "n", label: "genParamCount", type: "number", min: 1, max: 4, default: 1 },
    ],
  },
  {
    id: "together-image",
    name: "Together AI",
    kind: "image",
    available: true,
    baseUrl: "https://api.together.xyz/v1",
    authType: "bearer",
    endpoint: "images/generations",
    method: "POST",
    strategy: "direct",
    responseFormat: null,
    models: [
      "black-forest-labs/FLUX.1-schnell",
      "black-forest-labs/FLUX.1-dev",
      "stabilityai/stable-diffusion-xl-base-1.0",
    ],
    params: [
      {
        key: "size",
        label: "genParamSize",
        type: "select",
        options: ["1024x1024", "768x1024", "1024x768", "512x512"],
        default: "1024x1024",
      },
      { key: "n", label: "genParamCount", type: "number", min: 1, max: 4, default: 1 },
    ],
  },

  // ---- coming soon (listed for discovery, no live calls) ----
  { id: "midjourney", name: "Midjourney", kind: "image", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "ideogram", name: "Ideogram", kind: "image", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "recraft", name: "Recraft", kind: "image", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "leonardo", name: "Leonardo", kind: "image", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "runway", name: "Runway", kind: "video", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "kling", name: "Kling", kind: "video", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "veo", name: "Veo (Google)", kind: "video", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "luma", name: "Luma Dream Machine", kind: "video", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "suno", name: "Suno", kind: "audio", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "udio", name: "Udio", kind: "audio", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "stable-audio", name: "Stable Audio", kind: "audio", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
  { id: "elevenlabs", name: "ElevenLabs", kind: "voice", available: false, baseUrl: "", authType: "bearer", endpoint: "", method: "POST", models: [], params: [] },
];

export const GEN_BY_ID = new Map(GEN_PROVIDERS.map((p) => [p.id, p]));
export const GEN_BY_BASE_URL = new Map(GEN_PROVIDERS.map((p) => [p.baseUrl, p]));

/** Resolve the catalog entry a generative connection points at. Generation
 *  connections are regular `Connection`s with a fixed baseUrl, so baseUrl is
 *  the stable join key. */
export function providerForBaseUrl(baseUrl: string): GenerationProvider | undefined {
  return GEN_BY_BASE_URL.get(baseUrl.trim().replace(/\/+$/, ""));
}
