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
  /** "key" → `Authorization: Key <k>` (fal.ai); default bearer. */
  authScheme?: "bearer" | "key";
  /** Some providers (fal.ai) put the model in the URL path, not the body. */
  modelInPath?: boolean;
  /** How this provider accepts reference images attached in the prompt bar.
   *  `key` is the request-body field (fal.ai: `image_url` for image-to-video,
   *  `image_urls` for multi-reference / edit); `multiple` picks array vs single.
   *  Absent → the provider takes no image input and the paperclip stays off. */
  imageInput?: { key: string; multiple: boolean };
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
  authScheme?: "bearer" | "key";
  resultPath?: string;
  modelInBody?: boolean;
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

  // ---- fal.ai · one key, many models (image; video/audio via polling later) ----
  {
    id: "fal-image",
    name: "fal.ai",
    kind: "image",
    available: true,
    baseUrl: "https://fal.run",
    authType: "bearer",
    authScheme: "key",
    modelInPath: true,
    endpoint: "",
    method: "POST",
    strategy: "direct",
    responseFormat: null,
    resultPath: "images",
    // fal image models take reference images as an array of data-URIs; edit /
    // character-reference models (nano-banana/edit) use them, plain text-to-image
    // ignores them, so attaching is always safe.
    imageInput: { key: "image_urls", multiple: true },
    models: [
      "fal-ai/flux/schnell",
      "fal-ai/flux/dev",
      "fal-ai/flux-pro/v1.1",
      "fal-ai/nano-banana",
      "fal-ai/nano-banana/edit",
      "fal-ai/recraft-v3",
    ],
    params: [
      {
        key: "image_size",
        label: "genParamSize",
        type: "select",
        options: [
          "square_hd",
          "square",
          "landscape_16_9",
          "portrait_16_9",
          "landscape_4_3",
          "portrait_4_3",
        ],
        default: "landscape_16_9",
      },
      { key: "num_images", label: "genParamCount", type: "number", min: 1, max: 4, default: 1 },
    ],
  },

  {
    id: "fal-video",
    name: "fal.ai",
    kind: "video",
    available: true,
    baseUrl: "https://fal.run",
    authType: "bearer",
    authScheme: "key",
    modelInPath: true,
    endpoint: "",
    method: "POST",
    strategy: "poll",
    responseFormat: null,
    resultPath: "video",
    // Image-to-video models take a single starting frame as `image_url`; the
    // text-to-video ones ignore it, so one attachment is enough for either.
    imageInput: { key: "image_url", multiple: false },
    models: [
      "fal-ai/veo3",
      "fal-ai/kling-video/v2/master/text-to-video",
      "fal-ai/kling-video/v2/master/image-to-video",
      "fal-ai/bytedance/seedance/v1/pro/text-to-video",
      "fal-ai/bytedance/seedance/v1/pro/image-to-video",
      "fal-ai/minimax/hailuo-02/standard/text-to-video",
    ],
    params: [
      {
        key: "aspect_ratio",
        label: "genParamSize",
        type: "select",
        options: ["16:9", "9:16", "1:1"],
        default: "16:9",
      },
    ],
  },

  {
    id: "fal-audio",
    name: "fal.ai",
    kind: "audio",
    available: true,
    baseUrl: "https://fal.run",
    authType: "bearer",
    authScheme: "key",
    modelInPath: true,
    endpoint: "",
    method: "POST",
    // Audio generation is queued like video: submit → poll → fetch.
    strategy: "poll",
    responseFormat: null,
    resultPath: "audio",
    // Text-to-music / sound models take just a prompt; kept param-free so no
    // model rejects an option it doesn't know. fal ids drift — if a model
    // errors, fix the string here (same as video).
    models: [
      "fal-ai/stable-audio",
      "fal-ai/minimax-music",
      "fal-ai/ace-step",
    ],
    params: [],
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

const norm = (u: string) => u.trim().replace(/\/+$/, "");

/** Any available catalog entry for a connection's baseUrl — used to tell a
 *  generation connection from a text one. One aggregator (fal.ai) serves several
 *  modalities under one baseUrl, so this returns the first available match. */
export function providerForBaseUrl(baseUrl: string): GenerationProvider | undefined {
  const b = norm(baseUrl);
  return GEN_PROVIDERS.find((p) => p.available && norm(p.baseUrl) === b);
}

/** The provider for a specific modality on a connection — the studio picks this
 *  by (baseUrl, modality) so one fal.ai key covers image and video. */
export function providerFor(
  baseUrl: string,
  kind: GenerationKind,
): GenerationProvider | undefined {
  const b = norm(baseUrl);
  return GEN_PROVIDERS.find(
    (p) => p.available && p.kind === kind && norm(p.baseUrl) === b,
  );
}

/** Provider chips for Settings — one per available baseUrl (fal.ai serves
 *  several modalities under one key, so it must appear once), followed by the
 *  "coming soon" entries. */
export const GEN_PROVIDER_CHIPS: GenerationProvider[] = (() => {
  const seen = new Set<string>();
  return GEN_PROVIDERS.filter((p) => {
    if (!p.available) return true;
    const b = norm(p.baseUrl);
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
})();
